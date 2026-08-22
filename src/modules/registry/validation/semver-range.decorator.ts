import { buildMessage, ValidationOptions, ValidateBy } from "class-validator";
import { validRange } from "semver";

export function IsSemverRange(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: "isSemverRange",
      validator: {
        validate: (value: unknown) =>
          typeof value === "string" && validRange(value) !== null,
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix}$property must be a valid semver range`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
