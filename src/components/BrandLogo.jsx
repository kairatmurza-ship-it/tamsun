import { mediaUrl } from "../lib/store.js";

export default function BrandLogo({ className = "brand-logo" }) {
  return <img className={className} src={mediaUrl("tamsun-logo.png")} alt="Tamsun Group" />;
}
