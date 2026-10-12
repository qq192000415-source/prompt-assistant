import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'focus-visible:outline-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        unstyled: '',
        default: 'inline-flex items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90',
        destructive: 'inline-flex items-center justify-center gap-2 rounded-md bg-destructive text-sm font-medium text-destructive-foreground hover:bg-destructive/90',
        outline: 'inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium text-foreground hover:bg-accent',
        secondary: 'inline-flex items-center justify-center gap-2 rounded-md bg-secondary text-sm font-medium text-secondary-foreground hover:bg-secondary/80',
        ghost: 'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-accent',
      },
      size: {
        unstyled: '',
        default: 'h-9 px-3.5',
        sm: 'h-8 px-2.5 text-[13px]',
        lg: 'h-10 px-5',
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'unstyled',
      size: 'unstyled',
    },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
