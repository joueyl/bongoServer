import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function formatErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => {
      const constraints = e.constraints ? Object.values(e.constraints).join(', ') : '';
      return e.property ? `${e.property}: ${constraints}` : constraints;
    })
    .join('; ');
}

/**
 * 把客户端发来的原始 payload 转成 DTO 实例并校验。
 * 失败时返回统一的 `{ ok: false, error }` 错误文案，不向 socket 抛异常，
 * 保证所有 ack 的错误结构一致。
 */
export async function validatePayload<T extends object>(
  cls: new () => T,
  payload: unknown,
): Promise<ValidationResult<T>> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, error: 'payload 必须是对象' };
  }
  const value = plainToInstance(cls, payload);
  const errors = await validate(value, { whitelist: true });
  if (errors.length > 0) {
    return { ok: false, error: formatErrors(errors) };
  }
  return { ok: true, value };
}
