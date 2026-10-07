import { createContext, useContext, useEffect, useState } from "react";
import { flushPendingOrders, startCatalogSync, subscribeStore } from "./store.js";

const StoreContext = createContext(0);

export function useStoreVersion() {
  return useContext(StoreContext);
}

export default function StoreProvider({ children }) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    const unsubscribe = subscribeStore(bump);
    const stopSync = startCatalogSync();
    flushPendingOrders();
    window.addEventListener("storage", bump);
    return () => {
      unsubscribe();
      stopSync();
      window.removeEventListener("storage", bump);
    };
  }, []);

  return <StoreContext.Provider value={version}>{children}</StoreContext.Provider>;
}
