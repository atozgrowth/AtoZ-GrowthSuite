-- SYNTHETIC approximation of observed catalog facts, NOT the live function body.
CREATE TABLE public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id), full_name text, avatar_url text,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 fixture_extra text DEFAULT 'preserve-me'
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, TRUNCATE, TRIGGER ON public.profiles TO authenticated;
CREATE POLICY fixture_owner_select ON public.profiles FOR SELECT TO authenticated USING (auth.uid()=id);
CREATE POLICY fixture_owner_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid()=id);
CREATE POLICY fixture_owner_update ON public.profiles FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id);
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=public AS $$
 BEGIN
 INSERT INTO public.profiles(id,full_name) VALUES (NEW.id,'synthetic-provisioned')
 ON CONFLICT(id) DO UPDATE SET full_name=EXCLUDED.full_name;
 RETURN NEW;
 END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
INSERT INTO public.profiles(id,full_name) VALUES ('10000000-0000-4000-8000-000000000001','synthetic-existing');
