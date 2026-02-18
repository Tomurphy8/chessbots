declare module 'stockfish' {
  interface StockfishEngine {
    postMessage(message: string): void;
    addMessageListener(listener: (message: string) => void): void;
    removeMessageListener(listener: (message: string) => void): void;
    terminate(): void;
  }

  function Stockfish(): Promise<StockfishEngine>;
  export default Stockfish;
}
