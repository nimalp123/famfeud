CREATE TABLE public.rooms (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{6}$'),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  is_public boolean NOT NULL DEFAULT false,
  phase text NOT NULL CHECK (phase IN ('lobby', 'generating', 'playing', 'round-ended', 'finished')),
  updated_at bigint NOT NULL,
  CHECK (state ->> 'code' = code)
);

CREATE INDEX rooms_public_lobby_idx ON public.rooms (updated_at DESC)
  WHERE is_public AND phase = 'lobby';

CREATE TABLE public.rate_limits (
  scope text NOT NULL,
  key text NOT NULL,
  window_start bigint NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  expires_at bigint NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE INDEX rate_limits_expiry_idx ON public.rate_limits (expires_at);

CREATE TABLE public.question_bank (
  id text PRIMARY KEY,
  category text NOT NULL,
  prompt text NOT NULL UNIQUE,
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) = 6)
);

CREATE INDEX question_bank_category_idx ON public.question_bank (category);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rooms, public.rate_limits, public.question_bank FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms, public.rate_limits, public.question_bank TO project_admin;

CREATE FUNCTION public.feud_create_room(p_code text, p_state jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  affected integer;
BEGIN
  IF p_state ->> 'code' IS DISTINCT FROM p_code
     OR (p_state ->> 'revision')::integer IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Invalid initial room state';
  END IF;
  INSERT INTO public.rooms (code, state, revision, is_public, phase, updated_at)
  VALUES (p_code, p_state, 0, (p_state ->> 'isPublic')::boolean,
          p_state ->> 'phase', (p_state ->> 'updatedAt')::bigint)
  ON CONFLICT (code) DO NOTHING;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

CREATE FUNCTION public.feud_compare_and_set_room(p_code text, p_expected_revision integer, p_state jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  affected integer;
BEGIN
  IF p_state ->> 'code' IS DISTINCT FROM p_code
     OR (p_state ->> 'revision')::integer IS DISTINCT FROM p_expected_revision + 1 THEN
    RAISE EXCEPTION 'Invalid next room revision';
  END IF;
  IF jsonb_array_length(p_state -> 'players') = 0 THEN
    DELETE FROM public.rooms WHERE code = p_code AND revision = p_expected_revision;
  ELSE
    UPDATE public.rooms
    SET state = p_state,
        revision = p_expected_revision + 1,
        is_public = (p_state ->> 'isPublic')::boolean,
        phase = p_state ->> 'phase',
        updated_at = (p_state ->> 'updatedAt')::bigint
    WHERE code = p_code AND revision = p_expected_revision;
  END IF;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

CREATE FUNCTION public.feud_consume_rate_limit(p_scope text, p_key text, p_window_start bigint, p_expires_at bigint)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  INSERT INTO public.rate_limits AS current_limit (scope, key, window_start, hits, expires_at)
  VALUES (p_scope, p_key, p_window_start, 1, p_expires_at)
  ON CONFLICT (scope, key) DO UPDATE SET
    hits = CASE WHEN current_limit.window_start < excluded.window_start THEN 1 ELSE current_limit.hits + 1 END,
    window_start = GREATEST(current_limit.window_start, excluded.window_start),
    expires_at = GREATEST(current_limit.expires_at, excluded.expires_at)
  RETURNING hits;
$$;

CREATE FUNCTION public.feud_sample_questions(p_category text, p_excluded_ids text[], p_limit integer)
RETURNS TABLE (id text, category text, prompt text, answers jsonb)
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT q.id, q.category, q.prompt, q.answers
  FROM public.question_bank AS q
  WHERE (p_category = 'Anything goes' OR q.category = p_category)
    AND NOT (q.id = ANY(COALESCE(p_excluded_ids, ARRAY[]::text[])))
  ORDER BY random()
  LIMIT LEAST(GREATEST(p_limit, 0), 5);
$$;

CREATE FUNCTION public.feud_list_public_rooms(p_since bigint)
RETURNS TABLE (code text, "hostName" text, mode text, category text, players integer, "maxPlayers" integer)
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT r.code,
    COALESCE((SELECT player ->> 'name' FROM jsonb_array_elements(r.state -> 'players') AS player
      WHERE player ->> 'id' = r.state ->> 'hostId' LIMIT 1), 'Player') AS "hostName",
    r.state -> 'settings' ->> 'mode' AS mode,
    r.state -> 'settings' ->> 'category' AS category,
    jsonb_array_length(r.state -> 'players') AS players,
    (r.state -> 'settings' ->> 'maxPlayers')::integer AS "maxPlayers"
  FROM public.rooms AS r
  WHERE r.is_public AND r.phase = 'lobby' AND r.updated_at > p_since
    AND jsonb_array_length(r.state -> 'players') > 0
    AND jsonb_array_length(r.state -> 'players') < (r.state -> 'settings' ->> 'maxPlayers')::integer
  ORDER BY r.updated_at DESC
  LIMIT 60;
$$;

REVOKE ALL ON FUNCTION public.feud_create_room(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feud_compare_and_set_room(text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feud_consume_rate_limit(text, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feud_sample_questions(text, text[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feud_list_public_rooms(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feud_create_room(text, jsonb) TO project_admin;
GRANT EXECUTE ON FUNCTION public.feud_compare_and_set_room(text, integer, jsonb) TO project_admin;
GRANT EXECUTE ON FUNCTION public.feud_consume_rate_limit(text, text, bigint, bigint) TO project_admin;
GRANT EXECUTE ON FUNCTION public.feud_sample_questions(text, text[], integer) TO project_admin;
GRANT EXECUTE ON FUNCTION public.feud_list_public_rooms(bigint) TO project_admin;
