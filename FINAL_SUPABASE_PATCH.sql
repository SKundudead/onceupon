-- OnceUpon final compatibility + community feature patch
-- Run once in Supabase SQL Editor as project owner (postgres).
-- Safe to re-run. Never put service_role keys in the browser.

-- Preserve optional phone metadata during signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'phone', ''))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'reader')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Page navigation metadata only. Page bodies remain behind get_story_page().
CREATE OR REPLACE FUNCTION public.get_story_chapter_pages(p_chapter_id uuid)
RETURNS TABLE (page_id uuid, page_number integer, token_cost integer, story_page_number bigint, is_free boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH target_story AS (
    SELECT c.story_id FROM public.chapters c JOIN public.stories s ON s.id=c.story_id
    WHERE c.id=p_chapter_id AND s.status='published' LIMIT 1
  ), ranked_pages AS (
    SELECT p.id,p.chapter_id,p.page_number,p.token_cost,
      row_number() OVER (ORDER BY c.chapter_number,p.page_number,p.id) AS story_page_number
    FROM public.story_pages p JOIN public.chapters c ON c.id=p.chapter_id
    JOIN target_story ts ON ts.story_id=c.story_id
  )
  SELECT rp.id,rp.page_number,rp.token_cost,rp.story_page_number,
    (rp.story_page_number<=5 OR rp.token_cost=0) AS is_free
  FROM ranked_pages rp WHERE rp.chapter_id=p_chapter_id ORDER BY rp.page_number,rp.id;
$$;
REVOKE ALL ON FUNCTION public.get_story_chapter_pages(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_chapter_pages(uuid) TO anon, authenticated;

-- Approved readers may submit once per quest while they have no pending/approved submission.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quest_submissions' AND policyname='Approved readers submit own quest entries') THEN
    CREATE POLICY "Approved readers submit own quest entries" ON public.quest_submissions
      FOR INSERT TO authenticated WITH CHECK (
        user_id = (SELECT auth.uid()) AND public.is_approved_reader()
        AND EXISTS (SELECT 1 FROM public.quests q WHERE q.id=quest_id AND q.is_active=true
          AND (q.starts_at IS NULL OR q.starts_at<=now()) AND (q.deadline IS NULL OR q.deadline>=now()))
        AND NOT EXISTS (SELECT 1 FROM public.quest_submissions old
          WHERE old.quest_id=quest_id AND old.user_id=(SELECT auth.uid()) AND old.status IN ('pending','approved'))
      );
  END IF;
END $$;

-- Admins may create signed URLs for private quest evidence; users retain own-folder access.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Admins view quest evidence') THEN
    CREATE POLICY "Admins view quest evidence" ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id='quest-submissions' AND public.is_admin());
  END IF;
END $$;

-- Public readers can see only moderated/approved reviews.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reviews' AND policyname='Public view approved reviews') THEN
    CREATE POLICY "Public view approved reviews" ON public.reviews FOR SELECT TO anon, authenticated
      USING (moderation_status='approved');
  END IF;
END $$;

-- Atomic quest review + reward. A submission can be rewarded only once.
CREATE OR REPLACE FUNCTION public.review_quest_submission(
  p_submission_id uuid, p_decision text, p_reviewer_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_submission public.quest_submissions%ROWTYPE;
  v_quest public.quests%ROWTYPE;
  v_reward integer := 0;
  v_batch_id uuid;
  v_approved_count integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected'; END IF;
  SELECT * INTO v_submission FROM public.quest_submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quest submission not found'; END IF;
  IF v_submission.status <> 'pending' THEN RAISE EXCEPTION 'This submission has already been reviewed'; END IF;
  SELECT * INTO v_quest FROM public.quests WHERE id=v_submission.quest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quest not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_quest.id::text, 0));
  IF p_decision='approved' AND v_quest.max_completions IS NOT NULL THEN
    SELECT count(*) INTO v_approved_count FROM public.quest_submissions
      WHERE quest_id=v_quest.id AND status='approved';
    IF v_approved_count >= v_quest.max_completions THEN RAISE EXCEPTION 'Quest completion limit has been reached'; END IF;
  END IF;
  UPDATE public.quest_submissions SET status=p_decision, reviewer_id=auth.uid(),
    reviewer_note=nullif(left(coalesce(p_reviewer_note,''),1000),''), reviewed_at=now()
    WHERE id=p_submission_id;
  IF p_decision='approved' THEN
    v_reward := greatest(0,coalesce(v_quest.reward_tokens,0));
    IF v_reward > 0 THEN
      INSERT INTO public.token_batches(user_id,original_amount,remaining_amount,source,credited_at,expires_at,credit_key)
      VALUES (v_submission.user_id,v_reward,v_reward,'quest',now(),now()+interval '7 days',
        'quest:'||v_submission.id::text) RETURNING id INTO v_batch_id;
      INSERT INTO public.token_transactions(user_id,batch_id,amount,transaction_type,reason)
      VALUES (v_submission.user_id,v_batch_id,v_reward,'credit','Quest reward: '||v_quest.title);
    END IF;
  END IF;
  INSERT INTO public.admin_audit_logs(admin_id,action,target_type,target_id,reason,metadata)
  VALUES (auth.uid(),'quest_submission_'||p_decision,'quest_submission',v_submission.id,
    nullif(left(coalesce(p_reviewer_note,''),1000),''),jsonb_build_object('quest_id',v_quest.id,'reward_tokens',v_reward));
  RETURN jsonb_build_object('success',true,'status',p_decision,'reward_tokens',v_reward);
END;
$$;
REVOKE ALL ON FUNCTION public.review_quest_submission(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_quest_submission(uuid,text,text) TO authenticated;

-- Keep admin-only role assignment separate; first Owner remains a manual SQL action.
-- Run this block separately only after creating and email-verifying your own account.
-- Replace the email literal with your verified email; do not expose this block in the frontend.
/*
DO $$ DECLARE v_user_id uuid; BEGIN
  SELECT id INTO v_user_id FROM auth.users
  WHERE lower(email)=lower('YOUR_VERIFIED_EMAIL_HERE') AND email_confirmed_at IS NOT NULL LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No verified account found for that email'; END IF;
  INSERT INTO public.user_roles(user_id,role) VALUES(v_user_id,'owner')
  ON CONFLICT(user_id,role) DO NOTHING;
END $$;
*/
