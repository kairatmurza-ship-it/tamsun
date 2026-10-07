import { Link } from "react-router-dom";
import BrandLogo from "./BrandLogo.jsx";

export default function SiteFooter({ showProducts = true }) {
  return (
    <footer className="foot">
      <Link className="foot-brand" to="/">
        <BrandLogo className="foot-logo" />
      </Link>
      {showProducts ? (
        <Link className="foot-admin" to="/products">
          Товары
        </Link>
      ) : null}
      <Link className="foot-admin" to="/admin">
        Админка
      </Link>
      {showProducts ? null : (
        <Link className="foot-admin" to="/">
          Главная
        </Link>
      )}
      <span>Астана</span>
    </footer>
  );
}
