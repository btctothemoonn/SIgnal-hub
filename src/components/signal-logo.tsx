import Image from "next/image";

export function SignalLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/brand/signal-purple-icon.png"
      alt=""
      aria-hidden="true"
      data-signal-logo
      width={128}
      height={128}
      loading="eager"
      unoptimized
      className={`shrink-0 rounded-lg ${className}`}
    />
  );
}
