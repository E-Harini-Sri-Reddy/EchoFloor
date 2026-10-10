import type { InputHTMLAttributes, ReactNode } from "react";

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  const errorId = error ? `${htmlFor}-error` : undefined;
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  return (
    <label className="field" htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
      {hint ? (
        <small id={hintId} className="muted">
          {hint}
        </small>
      ) : null}
      {error ? (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export function TextInput({
  id,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      {...props}
    />
  );
}
