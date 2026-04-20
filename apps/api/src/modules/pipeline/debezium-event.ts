import { IsString, IsIn, IsUUID } from 'class-validator';

export class DebeziumUnwrappedEvent {
  @IsUUID()
  trace_id!: string;

  @IsUUID()
  connection_id!: string;

  @IsString()
  schema_name!: string;

  @IsIn(['inbound_outbox', 'replica_outbox'])
  __table!: 'inbound_outbox' | 'replica_outbox';

  @IsString()
  __schema!: string;

  @IsIn(['c', 'u', 'd'])
  __op!: 'c' | 'u' | 'd';
}
