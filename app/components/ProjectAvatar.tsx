import { Icon } from "@/app/components/ui/Icon";

// Project photo, or the project's initials when it
// has none (a folder icon when no project is chosen).
// Decorative: the name is always shown next to it, so
// the image itself has empty alt text.

export default function ProjectAvatar({
  name,
  imageUrl,
  size = 44,
  className = "",
}: {
  name: string;
  imageUrl: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("");

  return (
    <span
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-sunken text-xs font-semibold text-fg-muted ${className}`}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : initials ? (
        <span aria-hidden="true">{initials}</span>
      ) : (
        <Icon name="folder" size={Math.round(size * 0.45)} />
      )}
    </span>
  );
}
