/*
  RUN ONLY AFTER your own account is registered AND email-verified.
  Replace the email literal with your exact verified Supabase Auth email.
  Execute this once from the Supabase SQL Editor as the project owner.
*/
DO $$
DECLARE
    v_user_id uuid;
BEGIN
    SELECT u.id INTO v_user_id
    FROM auth.users AS u
    WHERE lower(u.email) = lower('YOUR_VERIFIED_EMAIL_HERE')
      AND u.email_confirmed_at IS NOT NULL
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No verified account found for that email';
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;
END $$;
