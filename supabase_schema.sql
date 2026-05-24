-- Tabela de sessões (uma por vez que ligar o agente)
CREATE TABLE meetings (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at  timestamptz DEFAULT now(),
  ended_at    timestamptz,
  source_lang text,
  target_lang text
);

-- Tabela de turnos (uma linha por frase final transcrita)
CREATE TABLE meeting_turns (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id           uuid REFERENCES meetings(id) ON DELETE CASCADE,
  created_at           timestamptz DEFAULT now(),
  original_text        text NOT NULL,
  translated_text      text,
  is_question          boolean DEFAULT false,
  suggested_response   text,
  suggested_response_pt text,
  key_points           text[]
);

-- Row Level Security (necessário para usar a anon key)
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_meetings"      ON meetings      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_meeting_turns" ON meeting_turns FOR ALL USING (true) WITH CHECK (true);
