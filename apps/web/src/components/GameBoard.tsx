'use client';

import { useState, useEffect, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

interface GameBoardProps {
  fen?: string;
  pgn?: string;
  onMove?: (move: { from: string; to: string; promotion?: string }) => void;
  interactive?: boolean;
  boardWidth?: number;
  lastMove?: { from: string; to: string };
}

export function GameBoard({ fen, pgn, onMove, interactive = false, boardWidth = 480, lastMove }: GameBoardProps) {
  const [game, setGame] = useState(new Chess());
  const [position, setPosition] = useState('start');

  useEffect(() => {
    if (fen) {
      setPosition(fen);
    } else if (pgn) {
      const g = new Chess();
      g.loadPgn(pgn);
      setGame(g);
      setPosition(g.fen());
    }
  }, [fen, pgn]);

  // Highlight last move squares
  const customSquareStyles = useMemo(() => {
    if (!lastMove) return {};
    const highlightColor = 'rgba(124, 58, 237, 0.35)'; // chess-accent with transparency
    return {
      [lastMove.from]: { backgroundColor: highlightColor },
      [lastMove.to]: { backgroundColor: highlightColor },
    };
  }, [lastMove]);

  function onDrop(sourceSquare: string, targetSquare: string): boolean {
    if (!interactive || !onMove) return false;
    try {
      const move = game.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
      if (!move) return false;
      setPosition(game.fen());
      onMove({ from: sourceSquare, to: targetSquare, promotion: move.promotion });
      return true;
    } catch {
      return false;
    }
  }

  return (
    <div className="rounded-lg overflow-hidden border border-chess-border">
      <Chessboard
        id="game-board"
        position={position}
        onPieceDrop={onDrop}
        boardWidth={boardWidth}
        isDraggablePiece={() => interactive}
        customDarkSquareStyle={{ backgroundColor: '#4c1d95' }}
        customLightSquareStyle={{ backgroundColor: '#c4b5fd' }}
        customBoardStyle={{ borderRadius: '0' }}
        customSquareStyles={customSquareStyles}
      />
    </div>
  );
}
