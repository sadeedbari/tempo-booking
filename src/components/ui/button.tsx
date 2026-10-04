"use client";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, type Size, type Variant } from "./button-class";
import { Spinner } from "./spinner";

export { buttonClass };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  pill?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "filled", size = "md", pill, loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button ref={ref} className={buttonClass(variant, size, pill, className)} disabled={disabled || loading} {...props}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});

/** Submit button that shows a spinner while its parent <form> action is pending. */
export function SubmitButton(props: ButtonProps) {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending || props.loading} {...props} />;
}
