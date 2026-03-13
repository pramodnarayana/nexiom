import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class IsVendorConfigConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }

    for (const val of Object.values(value as Record<string, unknown>)) {
      const type = typeof val;
      if (type !== 'string' && type !== 'number' && type !== 'boolean') {
        return false;
      }
    }

    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const value = args.value as unknown;

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      const receivedType = Array.isArray(value) ? 'array' : typeof value;
      return `${args.property} must be a valid primitive configuration record, received [${receivedType}]`;
    }

    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const type = typeof val;
      if (type !== 'string' && type !== 'number' && type !== 'boolean') {
        const receivedType = Array.isArray(val) ? 'array' : type;
        return `Parameter ${key} must be a primitive, received [${receivedType}]`;
      }
    }

    return `${args.property} must be a valid primitive configuration record`;
  }
}

export function IsVendorConfig(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsVendorConfigConstraint,
    });
  };
}
