import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Input } from '../ui';
import { parseAmount } from './logic';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix' | 'min'> & {
  value: number | undefined | null;
  onValue: (v: number | undefined) => void;
  /** Máximo de decimales que se conservan. */
  decimals?: number;
  /** Decimales mínimos al mostrar (importes: 2 → "9,60"). */
  minDecimals?: number;
  suffix?: ReactNode;
  prefix?: ReactNode;
  min?: number;
};

/**
 * Importe en formato español con decimales fijos al mostrarse ("77,40 €") y coma decimal al escribir.
 * Mismo comportamiento de edición que NumberInput: conserva el texto mientras se teclea ("12,").
 */
export function AmountInput({ value, onValue, decimals = 2, minDecimals = 0, suffix, prefix, min, className, ...rest }: Props) {
  const toText = (v: number | undefined | null) =>
    v == null || !Number.isFinite(v)
      ? ''
      : new Intl.NumberFormat('es-ES', { minimumFractionDigits: Math.min(minDecimals, decimals), maximumFractionDigits: decimals, useGrouping: false }).format(v);
  const [text, setText] = useState(toText(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      {...rest}
      inputMode="decimal"
      className={className}
      suffix={suffix}
      prefix={prefix}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(toText(value));
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = parseAmount(t);
        if (n === undefined) return onValue(undefined);
        if (Number.isFinite(n)) onValue(min != null ? Math.max(min, n) : n);
      }}
    />
  );
}

