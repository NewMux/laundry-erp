import clsx from 'clsx';
import { ITEM_ILLUSTRATIONS, SERVICE_ICONS, svgDataUri } from '../lib/illustrations';

const cache = new Map<string, string>();
function uri(svg: string) {
  let u = cache.get(svg);
  if (!u) {
    u = svgDataUri(svg);
    cache.set(svg, u);
  }
  return u;
}

/** Item picture: owner-uploaded photo, else the built-in illustration. */
export function ItemImage({ imageKey, imageFileId, alt, className }: { imageKey?: string | null; imageFileId?: string | null; alt: string; className?: string }) {
  if (imageFileId) {
    return <img src={`/api/files/${imageFileId}`} alt={alt} className={clsx('rounded-full object-cover', className)} loading="lazy" draggable={false} />;
  }
  const ill = ITEM_ILLUSTRATIONS[imageKey ?? ''] ?? ITEM_ILLUSTRATIONS.other;
  return <img src={uri(ill.svg)} alt={alt} className={className} draggable={false} />;
}

export function ServiceIcon({ iconKey, alt, className }: { iconKey?: string | null; alt: string; className?: string }) {
  const ic = SERVICE_ICONS[iconKey ?? ''] ?? SERVICE_ICONS.default;
  return <img src={uri(ic.svg)} alt={alt} className={className} draggable={false} />;
}
