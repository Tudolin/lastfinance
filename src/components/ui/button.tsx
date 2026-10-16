import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-colors disabled:opacity-50 disabled:pointer-events-none min-h-11 px-4 text-sm',
  {
    variants: {
      variant: {
        primary:
          'bg-[#0b6e55] text-white hover:bg-[#095c47] dark:bg-[#2e9a78] dark:hover:bg-[#278667]',
        dark: 'bg-ink text-bg hover:opacity-90',
        outline: 'border border-border-strong bg-surface text-ink hover:bg-surface-2',
        ghost: 'text-ink hover:bg-surface-2',
        danger: 'bg-danger-soft text-danger-ink hover:opacity-90',
        dashed: 'border-2 border-dashed border-ink-3 bg-transparent text-ink hover:bg-surface-2',
      },
      size: {
        md: '',
        lg: 'min-h-12 text-[15px]',
        sm: 'min-h-9 px-3 text-[13px]',
        icon: 'size-11 px-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
