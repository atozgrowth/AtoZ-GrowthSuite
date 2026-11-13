CREATE TABLE IF NOT EXISTS public.wordpress_site_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_url text NOT NULL,
  CONSTRAINT wordpress_site_connections_user_id_site_url_key UNIQUE (user_id, site_url)
);

ALTER TABLE public.wordpress_site_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own WordPress site connections"
ON public.wordpress_site_connections;

CREATE POLICY "Users can read their own WordPress site connections"
ON public.wordpress_site_connections
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
