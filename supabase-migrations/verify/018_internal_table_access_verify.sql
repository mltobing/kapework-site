-- Read-only authorization probes: EXPLAIN without ANALYZE does not execute DML.
-- No private row contents are returned; all session changes are rolled back.
begin;
set local statement_timeout = '30s';

do $verify$
declare
  table_name text;
  role_name text;
  column_name text;
  operation text;
  command text;
  denied boolean;
  denied_count integer := 0;
begin
  foreach table_name in array array['internal_people','internal_devices'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=table_name and c.relrowsecurity) then
      raise exception 'RLS is not enabled on %', table_name;
    end if;
    foreach role_name in array array['anon','authenticated'] loop
      if has_table_privilege(role_name, format('public.%I',table_name),
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(role_name, format('public.%I',table_name),
          'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'Browser role % retains access to %',role_name,table_name;
      end if;
    end loop;
    if not has_table_privilege('service_role',format('public.%I',table_name),'SELECT')
      or not has_table_privilege('service_role',format('public.%I',table_name),'INSERT')
      or not has_table_privilege('service_role',format('public.%I',table_name),'UPDATE')
      or not has_table_privilege('service_role',format('public.%I',table_name),'DELETE') then
      raise exception 'Existing service_role access was not preserved on %',table_name;
    end if;
  end loop;

  foreach role_name in array array['anon','authenticated'] loop
    foreach table_name in array array['internal_people','internal_devices'] loop
      select a.attname into strict column_name from pg_attribute a
        where a.attrelid=format('public.%I',table_name)::regclass
          and a.attnum>0 and not a.attisdropped order by a.attnum limit 1;
      foreach operation in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        command := case operation
          when 'SELECT' then format('EXPLAIN SELECT 1 FROM public.%I WHERE false',table_name)
          when 'INSERT' then format('EXPLAIN INSERT INTO public.%I DEFAULT VALUES',table_name)
          when 'UPDATE' then format('EXPLAIN UPDATE public.%I SET %I=%I WHERE false',table_name,column_name,column_name)
          when 'DELETE' then format('EXPLAIN DELETE FROM public.%I WHERE false',table_name)
        end;
        denied := false;
        execute format('set local role %I',role_name);
        begin
          execute command;
        exception when insufficient_privilege then
          denied := true;
        end;
        reset role;
        if not denied then
          raise exception '% unexpectedly permitted % on %',role_name,operation,table_name;
        end if;
        denied_count := denied_count+1;
      end loop;
    end loop;
  end loop;
  if denied_count<>16 then raise exception 'Expected 16 denied probes, got %',denied_count; end if;
end;
$verify$;

select 'PASS: RLS enabled, browser privileges removed, 16 authorization probes denied, service_role preserved' as result;
rollback;
