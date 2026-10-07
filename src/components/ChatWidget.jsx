import { useEffect, useRef, useState } from "react";
import { useStoreVersion } from "../lib/StoreProvider.jsx";
import { bindChatResize } from "../lib/chat-resize.js";
import {
  consult,
  defaultChips,
  fileToAttachment,
  greetingReply,
  handoffAction,
  isCartRequest,
  loadSession,
  requestAiReply,
  saveSession,
  visibleProducts,
} from "../lib/consult.js";
import BrandLogo from "./BrandLogo.jsx";
import { addToCart, formatPrice, getProductPriceKzt, isInCart, mediaUrl } from "../lib/store.js";

function ChatProductCard({ product, sessionRef }) {
  useStoreVersion();
  const already = isInCart(product.id);
  return (
    <article className="chat-card">
      {product.image ? <img src={mediaUrl(product.image)} alt={product.name} /> : null}
      <div>
        <strong>{product.name}</strong>
        <em>{formatPrice(getProductPriceKzt(product))}</em>
        {[product.size, product.material].filter(Boolean).length ? <p>{[product.size, product.material].filter(Boolean).join(" · ")}</p> : null}
        <div className="chat-card-actions">
          <button
            type="button"
            disabled={already}
            onClick={() => {
              const result = addToCart(product.id, 1);
              if (result === "missing") return;
              sessionRef.current.lastProductIds = [product.id];
              saveSession(sessionRef.current);
            }}
          >
            {already ? "В корзине" : "В корзину"}
          </button>
          <a
            href={`https://wa.me/77012271505?text=${encodeURIComponent(
              `Здравствуйте! Интересует «${product.name}» — ${formatPrice(getProductPriceKzt(product))}.`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            data-order-source="chat"
            data-product-id={product.id}
          >
            Заказать
          </a>
        </div>
      </div>
    </article>
  );
}

export default function ChatWidget() {
  const version = useStoreVersion();
  const rootRef = useRef(null);
  const widthRef = useRef(null);
  const heightRef = useRef(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const sessionRef = useRef(null);
  const replyToken = useRef(0);
  const sentUrls = useRef([]);
  const inflight = useRef(null);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chips, setChips] = useState([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [fileNote, setFileNote] = useState("");
  const [typing, setTyping] = useState(false);
  const [linkMode, setLinkMode] = useState("online");
  const [live, setLive] = useState("");

  if (!sessionRef.current) sessionRef.current = loadSession();

  useEffect(() => {
    const session = sessionRef.current;
    if (!session.messages.length) {
      const hello = greetingReply();
      setMessages([hello]);
      session.messages.push({ role: "in", text: hello.text });
      saveSession(session);
      setChips(hello.chips);
      setLive(hello.text);
      return;
    }
    const products = visibleProducts();
    setMessages(
      session.messages.map((message) => ({
        role: message.role,
        text: message.text,
        productIds: message.productIds || [],
        products: message.productIds ? products.filter((item) => message.productIds.includes(item.id)) : [],
        files: (message.fileNames || []).map((name) => ({ name })),
        actions: handoffAction(message.handoff),
        handoff: message.handoff || "",
      }))
    );
    setChips(defaultChips());
  }, []);

  useEffect(() => {
    setMessages((current) =>
      current.map((message) => {
        if (!message.productIds?.length) return message;
        const products = visibleProducts().filter((item) => message.productIds.includes(item.id));
        return { ...message, products };
      })
    );
  }, [version]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, typing, chips]);

  useEffect(() => {
    const urls = sentUrls.current;
    return () => {
      const current = inflight.current;
      if (current) {
        current.replaced = true;
        current.abort();
      }
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("chat-open", open);
    if (open) inputRef.current?.focus({ preventScroll: true });
    return () => document.documentElement.classList.remove("chat-open");
  }, [open]);

  useEffect(() => {
    const root = rootRef.current;
    const log = logRef.current;
    if (!root || !log) return undefined;
    const onWheel = (event) => {
      if (!open) return;
      if (!log.contains(event.target)) {
        event.preventDefault();
        return;
      }
      log.scrollTop += event.deltaY;
      event.preventDefault();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [open]);

  useEffect(() => {
    if (rootRef.current) bindChatResize(rootRef.current, widthRef.current, heightRef.current);
  }, []);

  function rememberReply(reply) {
    const session = sessionRef.current;
    session.messages.push({
      role: "in",
      text: reply.text,
      productIds: (reply.products || []).map((item) => item.id),
      handoff: reply.handoff || "",
    });
    if (reply.productIds && reply.productIds.length) session.lastProductIds = reply.productIds;
    else if (reply.topic === "service" || reply.topic === "about" || reply.topic === "contact" || reply.topic === "order") {
      session.lastProductIds = [];
    }
    session.lastTopic = reply.topic || session.lastTopic;
    if (session.messages.length > 24) session.messages = session.messages.slice(-24);
    saveSession(session);
  }

  function stopInflight() {
    const current = inflight.current;
    if (!current) return;
    current.replaced = true;
    current.abort();
    inflight.current = null;
  }

  function showReply(token, reply, mode) {
    if (!reply || token !== replyToken.current) return;
    setTyping(false);
    setLinkMode(mode);
    setMessages((current) => [...current, reply]);
    rememberReply(reply);
    setChips(reply.chips || defaultChips());
    setLive(reply.text || "");
  }

  function localFallback(message, shown, error, files) {
    let local;
    try {
      local = consult(message || shown, sessionRef.current);
    } catch (again) {
      local = {
        role: "in",
        text: "Сейчас не получилось ответить. Напишите ещё раз или откройте каталог.",
        chips: defaultChips(),
        products: [],
        actions: [],
      };
    }
    const reason = error && error.name === "AbortError" ? "timeout" : error && error.message ? error.message : "";
    if (reason === "too_large") {
      local.text = "Вложения слишком большие. Документ — до 1,5 МБ, фото можно крупнее: оно сожмётся само.";
    } else if (reason === "rate") {
      local.text = "Слишком много сообщений подряд. Отвечаю по каталогу.\n\n" + local.text;
    } else if (files.length && reason !== "api" && reason !== "unavailable" && reason !== "server_error" && reason !== "timeout") {
      local.text = "Не получилось отправить вложение.\n\n" + local.text;
    } else {
      local.text = "Связь с консультантом прервалась, отвечаю по каталогу.\n\n" + local.text;
    }
    return local;
  }

  function finishSend() {
    busy.current = false;
  }

  function ask(text, withFiles) {
    const message = String(text || "").trim();
    const files = withFiles ? pendingFiles.slice() : [];
    if (busy.current || (!message && !files.length)) return;
    busy.current = true;
    const shown = message || files.map((file) => file.name).join(", ");
    const sentFiles = files.map((file) => ({ name: file.name, type: file.type, url: file.url }));
    sentFiles.forEach((file) => {
      if (file.url) sentUrls.current.push(file.url);
    });
    setPendingFiles([]);
    setFileNote("");
    setMessages((current) => [...current, { role: "out", text: message, files: sentFiles }]);
    const session = sessionRef.current;
    session.messages.push({
      role: "out",
      text: shown,
      fileNames: files.map((file) => file.name),
    });
    saveSession(session);
    setInput("");
    setChips([]);
    const token = ++replyToken.current;
    if (!files.length && isCartRequest(message)) {
      stopInflight();
      let reply;
      try {
        reply = consult(message, session);
      } catch (error) {
        reply = localFallback(message, shown, error, files);
        showReply(token, reply, "catalog");
        finishSend();
        return;
      }
      showReply(token, reply, "online");
      finishSend();
      return;
    }
    if (isCartRequest(message)) {
      try {
        consult(message, session);
      } catch (error) {
        console.error("chat_cart_local_failed");
      }
    }
    setTyping(true);
    stopInflight();
    const controller = new AbortController();
    inflight.current = controller;
    const timer = setTimeout(() => controller.abort(), 35000);
    Promise.all(files.map((file) => fileToAttachment(file.file)))
      .then((attachments) => {
        if (controller.replaced || token !== replyToken.current) throw Object.assign(new Error("replaced"), { name: "AbortError" });
        return requestAiReply(session, attachments, controller.signal);
      })
      .then((reply) => {
        clearTimeout(timer);
        if (inflight.current === controller) inflight.current = null;
        finishSend();
        showReply(token, reply, "online");
      })
      .catch((error) => {
        clearTimeout(timer);
        if (inflight.current === controller) inflight.current = null;
        finishSend();
        if (controller.replaced || (error && error.message === "replaced") || token !== replyToken.current) return;
        showReply(token, localFallback(message, shown, error, files), "catalog");
      });
  }

  const pendingRef = useRef([]);
  pendingRef.current = pendingFiles;

  function addPending(list) {
    const incoming = Array.from(list || []);
    const next = pendingRef.current.slice();
    let note = "";
    incoming.forEach((file) => {
      if (next.length >= 4) {
        note = "Можно прикрепить до 4 файлов за раз.";
        return;
      }
      const type = String(file.type || "").toLowerCase();
      const resizable = /^image\/(jpeg|png|gif|webp)$/.test(type);
      const limit = resizable ? 12 * 1024 * 1024 : Math.round(1.5 * 1024 * 1024);
      if (file.size > limit) {
        note = resizable ? "Фото больше 12 МБ. Выберите снимок поменьше." : "Документ больше 1,5 МБ.";
        return;
      }
      next.push({
        name: file.name || "файл",
        type: file.type || "",
        file,
        url: type.startsWith("image/") ? URL.createObjectURL(file) : "",
      });
    });
    setPendingFiles(next);
    setFileNote(note);
  }

  return (
    <div className={open ? "chat-widget is-open" : "chat-widget"} ref={rootRef}>
      <div className="chat-panel" id="chat-panel" hidden={!open}>
        <button type="button" className="chat-resize" ref={widthRef} aria-label="Изменить ширину чата" />
        <button type="button" className="chat-resize-y" ref={heightRef} aria-label="Изменить высоту чата" />
        <div className="chat-head">
          <div className="chat-brand">
            <BrandLogo />
            <div>
              <strong>Консультант</strong>
              <span className={linkMode === "catalog" ? "chat-status is-catalog" : "chat-status"}>
                {linkMode === "catalog" ? "Tamsun · по каталогу" : "Tamsun · онлайн"}
              </span>
            </div>
          </div>
          <button type="button" className="chat-close" aria-label="Закрыть" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        <div className="chat-log" id="chat-log" ref={logRef}>
          <p className="chat-live" aria-live="polite">
            {live}
          </p>
          {messages.map((message, index) => (
            <div className={message.role === "out" ? "chat-msg chat-msg-out" : "chat-msg chat-msg-in"} key={index}>
              {message.files?.length ? (
                <div className="chat-sent-files">
                  {message.files.map((file, fileIndex) =>
                    file.url && String(file.type || "").startsWith("image/") ? (
                      <img src={file.url} alt={file.name || "Изображение"} key={fileIndex} />
                    ) : (
                      <span key={fileIndex}>{file.name || "Файл"}</span>
                    )
                  )}
                </div>
              ) : null}
              {message.text ? (
                <p className={message.role === "out" ? "chat-bubble chat-bubble-out" : "chat-bubble chat-bubble-in"}>{message.text}</p>
              ) : null}
              {message.products?.length ? (
                <div className="chat-cards">
                  {message.products.map((product) => (
                    <ChatProductCard product={product} sessionRef={sessionRef} key={product.id} />
                  ))}
                </div>
              ) : null}
              {message.actions?.length ? (
                <div className="chat-actions">
                  {message.actions.map((action) => (
                    <a
                      key={action.label + action.href}
                      href={action.href}
                      target={action.external ? "_blank" : undefined}
                      rel={action.external ? "noopener noreferrer" : undefined}
                      data-order-source={action.orderSource || undefined}
                      data-product-id={action.productId || undefined}
                      className={action.primary ? "chat-action-primary" : undefined}
                    >
                      {action.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {typing ? (
            <p className="chat-bubble chat-bubble-in chat-typing">
              <i />
              <i />
              <i />
            </p>
          ) : null}
        </div>
        <div className="chat-quick" hidden={!chips.length}>
          {chips.slice(0, 4).map((label) => (
            <button type="button" key={label} onClick={() => ask(label, false)}>
              {label}
            </button>
          ))}
        </div>
        <form
          className="chat-form"
          onSubmit={(event) => {
            event.preventDefault();
            ask(input, true);
          }}
        >
          <div className="chat-files" hidden={!pendingFiles.length}>
            {pendingFiles.map((file, index) => (
              <span className="chat-file-chip" key={file.name + index}>
                {file.url ? <img src={file.url} alt="" /> : null}
                <span>{file.name}</span>
                <button
                  type="button"
                  aria-label={"Убрать " + file.name}
                  onClick={() => {
                    setPendingFiles((current) => {
                      const next = current.slice();
                      const removed = next.splice(index, 1)[0];
                      if (removed?.url) URL.revokeObjectURL(removed.url);
                      return next;
                    });
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <p className="chat-file-note" hidden={!fileNote}>
            {fileNote}
          </p>
          <div className="chat-compose">
            <button type="button" className="chat-attach" aria-label="Прикрепить файл или изображение" disabled={typing} onClick={() => fileRef.current?.click()}>
              +
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="*/*"
              multiple
              hidden
              onChange={(event) => {
                addPending(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={inputRef}
              type="text"
              value={input}
              placeholder="Спросите про изделие или повод"
              autoComplete="off"
              disabled={typing}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
        </form>
      </div>
      <button
        type="button"
        className="chat-toggle"
        aria-label="Спросить AI"
        aria-expanded={open}
        hidden={open}
        onClick={() => setOpen(true)}
      >
        <span>Спросить AI</span>
      </button>
    </div>
  );
}
