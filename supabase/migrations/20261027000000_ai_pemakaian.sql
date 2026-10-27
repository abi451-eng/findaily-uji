-- Catatan pemakaian fitur AI (untuk batas harian & memantau biaya). Tanpa gambar.
create table if not exists public.ai_pemakaian (
    id            bigint generated always as identity primary key,
    instansi_id   uuid not null references public.instansi(id) on delete cascade,
    user_id       uuid,
    fitur         text not null default 'baca-catatan',
    model         text,
    status        text not null check (status in ('ok', 'gagal', 'ditolak')),
    input_tokens  int,
    output_tokens int,
    keterangan    text,
    waktu         timestamptz not null default now()
);
create index if not exists ai_pemakaian_instansi_waktu on public.ai_pemakaian (instansi_id, waktu desc);

alter table public.ai_pemakaian enable row level security;
-- Dibuat hanya kalau belum ada (aman dijalankan ulang, tanpa DROP)
do $$
begin
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = 'ai_pemakaian' and policyname = 'ai_pemakaian_lihat') then
        create policy ai_pemakaian_lihat on public.ai_pemakaian for select to authenticated
            using (public.fd_is_admin(instansi_id));
    end if;
end $$;

revoke all on public.ai_pemakaian from anon, authenticated;
grant select on public.ai_pemakaian to authenticated;
grant usage on schema public to service_role;
grant select, insert on public.ai_pemakaian to service_role;
