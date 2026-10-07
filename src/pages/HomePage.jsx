import { useEffect } from "react";
import { Link } from "react-router-dom";
import ServicesGrid from "../components/ServicesGrid.jsx";
import ShopGrid from "../components/ShopGrid.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import { mediaUrl } from "../lib/store.js";

export default function HomePage() {
  useEffect(() => {
    document.title = "Tamsun Group — премиальные сувениры Астаны";
  }, []);

  return (
    <>
      <main id="top">
        <section className="hero">
          <div className="hero-media">
            <img className="hero-art" src={mediaUrl("tamsun-hero.jpg")} alt="Tamsun Group" width="1920" height="1080" />
          </div>
          <div className="hero-copy">
            <div className="hero-text">
              <h1>Подарок, после которого вас помнят</h1>
              <p>
                Премиальные сувениры полного цикла в Астане. Создадим изделие под ваш жест — или выберем традицию с историей, которую уже вручали послам и высоким гостям страны.
              </p>
              <div className="hero-actions">
                <Link className="btn" to="/products">
                  Смотреть все товары
                </Link>
                <a className="text-link" href="#services">
                  Услуги под заказ
                </a>
              </div>
            </div>
            <figure className="hero-product">
              <img src={mediaUrl("tamsun-gift.jpg")} alt="Премиальный сувенир Tamsun" width="900" height="900" />
            </figure>
          </div>
        </section>

        <section className="made" id="made">
          <div className="made-copy">
            <h2>От идеи до упаковки</h2>
            <p>
              Никаких чужих каталогов и случайного качества. Эскиз, материал, сборка и финальный штрих — под контролем Tamsun Group. Чтобы вручать было так же приятно, как получать.
            </p>
          </div>
          <figure className="made-visual">
            <video className="made-video" src={mediaUrl("tamsun-workshop.mp4")} autoPlay muted loop playsInline controls />
          </figure>
        </section>

        <section className="order" id="order">
          <div className="order-inner">
            <div className="order-copy">
              <h2>Ваш смысл. Наша форма.</h2>
              <p>
                Юбилей, визит, корпоративный символ или тонкий дипломатический жест — расскажите, что должно остаться после встречи. Мы превратим это в предмет из металла, дерева, керамики или смешанных техник.
              </p>
            </div>
            <div className="order-visuals">
              <figure className="order-visual">
                <img src={mediaUrl("tamsun-form.jpg")} alt="Браслет Tamsun" width="1200" height="1600" />
              </figure>
              <figure className="order-visual">
                <img src={mediaUrl("tamsun-form-3.jpg")} alt="Изделие Tamsun" width="1200" height="1600" />
              </figure>
              <figure className="order-visual">
                <img src={mediaUrl("tamsun-form-2.jpg")} alt="Шахматный набор Tamsun" width="1200" height="1600" />
              </figure>
            </div>
          </div>
        </section>

        <ServicesGrid />

        <section className="pieces" id="shop">
          <div className="pieces-bg" aria-hidden="true">
            <img src="https://images.unsplash.com/photo-1578662996442-48f60103fc96?auto=format&fit=crop&w=2000&q=80" alt="" />
          </div>
          <div className="pieces-shell">
            <div className="pieces-intro shop-intro-row">
              <div>
                <h2>Магазин</h2>
                <p>Красота с первого взгляда. История — с первой секунды в руках.</p>
              </div>
              <Link className="btn shop-all-btn" to="/products">
                Все товары
              </Link>
            </div>
            <ShopGrid />
          </div>
        </section>

        <section className="proof">
          <p>Особый подарок для особых гостей. Традиции, которыми хочется гордиться.</p>
        </section>

        <section className="ask" id="ask">
          <a className="ig-qr" href="https://www.instagram.com/tamsun_astana/" target="_blank" rel="noopener noreferrer">
            <img src={mediaUrl("instagram-qr.png")} alt="QR-код Instagram tamsun_astana" width="400" height="400" />
            <span>@tamsun_astana</span>
          </a>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
