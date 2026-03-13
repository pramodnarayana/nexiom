import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class IsVendorConfigConstraint implements ValidatorConstraintInterface {
  private failedKey: string | null = null;
  private failedType: string | null = null;

  validate(value: any) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.failedKey = 'root object';
      this.failedType = typeof value;
      return false;
    }

    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const type = typeof val;
      if (type !== 'string' && type !== 'number' && type !== 'boolean') {
        this.failedKey = key;
        this.failedType = Array.isArray(val) ? 'array' : type;
        return false;
      }
    }

    return true;
  }

  defaultMessage(args: ValidationArguments) {
    if (this.failedKey === 'root object') {
      return `${args.property} must be a valid primitive configuration record, received [${this.failedType}]`;
    }
    return `Parameter ${this.failedKey} must be a primitive, received [${this.failedType}]`;
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
