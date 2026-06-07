import { validate } from 'class-validator';
import { DebeziumUnwrappedEvent } from './debezium-event.js';
import { v4 as uuidv4 } from 'uuid';

describe('DebeziumUnwrappedEvent', () => {
  it('should validate a correct event', async () => {
    const event = new DebeziumUnwrappedEvent();
    event.trace_id = uuidv4();
    event.data_source_id = uuidv4();
    event.schema_name = 'public';
    event.__table = 'inbound_outbox';
    event.__schema = 'public';
    event.__op = 'c';

    const errors = await validate(event);
    expect(errors.length).toBe(0);
  });

  it('should fail validation when trace_id is not a UUID', async () => {
    const event = new DebeziumUnwrappedEvent();
    event.trace_id = uuidv4();
    event.data_source_id = uuidv4();
    event.schema_name = 'public';
    event.__table = 'inbound_outbox';
    event.__schema = 'public';
    event.__op = 'c';
    // Now mutate only the target field
    event.trace_id = 'not-a-uuid';

    const errors = await validate(event);
    expect(errors.length).toBeGreaterThan(0);
    const errorProperties = errors.map((e) => e.property);
    expect(errorProperties).toContain('trace_id');
  });

  it('should fail validation on invalid table name', async () => {
    const event = new DebeziumUnwrappedEvent();
    event.trace_id = uuidv4();
    event.data_source_id = uuidv4();
    event.schema_name = 'public';
    event.__table = 'inbound_outbox';
    event.__schema = 'public';
    event.__op = 'c';
    // Now mutate only the target field
    (event as any).__table = 'invalid_table';

    const errors = await validate(event);
    expect(errors.length).toBeGreaterThan(0);
    const errorProperties = errors.map((e) => e.property);
    expect(errorProperties).toContain('__table');
  });

  it('should fail validation on invalid operation', async () => {
    const event = new DebeziumUnwrappedEvent();
    event.trace_id = uuidv4();
    event.data_source_id = uuidv4();
    event.schema_name = 'public';
    event.__table = 'inbound_outbox';
    event.__schema = 'public';
    event.__op = 'c';
    // Now mutate only the target field
    (event as any).__op = 'invalid_op';

    const errors = await validate(event);
    expect(errors.length).toBeGreaterThan(0);
    const errorProperties = errors.map((e) => e.property);
    expect(errorProperties).toContain('__op');
  });
});
