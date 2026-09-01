create or replace view public.llm_intelligence_runtime_summary as
with reg as (
  select count(*)::bigint as registry_total,
         count(*) filter (where runtime_enabled)::bigint as runtime_enabled,
         count(*) filter (where autonomous_enabled)::bigint as autonomous_enabled,
         count(*) filter (where promotion_enabled)::bigint as promotion_enabled
  from grk_runtime.registry_records
), ex as (
  select count(*)::bigint as execution_total,
         count(*) filter (where upper(status::text) in ('RUNNING','ACTIVE','STARTED'))::bigint as running,
         count(*) filter (where upper(status::text) in ('SUCCEEDED','COMPLETED'))::bigint as completed,
         count(*) filter (where upper(status::text) in ('FAILED','ERROR'))::bigint as failed
  from grk_runtime.executions
), tel as (
  select count(*)::bigint as telemetry_total,
         max(observed_at) as last_telemetry_at
  from grk_runtime.telemetry_events
), rec as (
  select count(*)::bigint as receipt_total,
         count(*) filter (where success)::bigint as successful_receipts,
         max(created_at) as last_receipt_at
  from grk_runtime.receipts
), search as (
  select count(*)::bigint as indexed_objects,
         max(indexed_at) as last_indexed_at
  from knowledge_runtime.search_index
), ingest as (
  select count(*)::bigint as ingestion_events,
         count(*) filter (where lower(status) in ('completed','success','succeeded'))::bigint as successful_ingestion_events,
         max(updated_at) as last_ingestion_at
  from knowledge_runtime.ingestion_events
)
select reg.registry_total, reg.runtime_enabled, reg.autonomous_enabled, reg.promotion_enabled,
       ex.execution_total, ex.running, ex.completed, ex.failed,
       tel.telemetry_total, tel.last_telemetry_at,
       rec.receipt_total, rec.successful_receipts, rec.last_receipt_at,
       search.indexed_objects, search.last_indexed_at,
       ingest.ingestion_events, ingest.successful_ingestion_events, ingest.last_ingestion_at,
       case when ex.running > 0 and tel.last_telemetry_at is not null then 'REAL' else 'PARTIAL' end as runtime_state
from reg, ex, tel, rec, search, ingest;

comment on view public.llm_intelligence_runtime_summary is
'Evidence-backed LLM/agent runtime summary. Catalogue counts are not presented as running.';
