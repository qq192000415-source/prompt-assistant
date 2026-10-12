import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="prompt-toaster"
      duration={2200}
      position="bottom-right"
      closeButton={false}
      {...props}
    />
  );
};

export { Toaster };
