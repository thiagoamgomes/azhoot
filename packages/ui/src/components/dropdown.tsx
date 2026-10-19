import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as React from 'react';
import { cn } from '../cn';

export const DropdownMenu = Dropdown.Root;
export const DropdownMenuTrigger = Dropdown.Trigger;

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof Dropdown.Content>,
  React.ComponentPropsWithoutRef<typeof Dropdown.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <Dropdown.Portal>
    <Dropdown.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-44 rounded-xl border border-border bg-surface p-1 text-foreground shadow-lg',
        className,
      )}
      {...props}
    />
  </Dropdown.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof Dropdown.Item>,
  React.ComponentPropsWithoutRef<typeof Dropdown.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <Dropdown.Item
    ref={ref}
    className={cn(
      'flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-lg px-3 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4',
      destructive && 'text-danger',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuSeparator = () => <Dropdown.Separator className="my-1 h-px bg-border" />;
