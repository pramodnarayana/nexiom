import { IsString, IsIn, IsUUID, IsOptional } from 'class-validator';

export class DebeziumUnwrappedEvent {
  @IsUUID()
  trace_id!: string;

  @IsOptional()
  @IsUUID()
  data_source_id?: string;

  @IsOptional()
  @IsString()
  schema_name?: string;

  @IsIn([
    'inbound_outbox',
    'replica_outbox',
    'normalized_outbox',
    'outbound_outbox',
  ])
  __table!:
    | 'inbound_outbox'
    | 'replica_outbox'
    | 'normalized_outbox'
    | 'outbound_outbox';

  @IsString()
  __schema!: string;

  @IsIn(['c', 'u', 'd'])
  __op!: 'c' | 'u' | 'd';
}
