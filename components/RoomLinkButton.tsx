"use client";

import { useState } from "react";
import { Check, Link } from "lucide-react";
import { roomLink } from "../lib/client";

interface RoomLinkButtonProps {
  code: string;
  className: string;
  showCode?: boolean;
}

export default function RoomLinkButton({ code, className, showCode = false }: RoomLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState("");

  async function copyLink() {
    const link = roomLink(code, window.location.origin, window.parent !== window ? document.referrer : "");
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setFallback(link);
    }
  }

  const label = showCode ? <span>Room <strong>{code}</strong></span> : <> <Link size={16} /> Room link</>;
  if (fallback) {
    return <a className={className} href={fallback} target="_blank" rel="noreferrer" title="Open this room link or copy it from your browser">{label}</a>;
  }
  return (
    <button className={className} type="button" onClick={() => void copyLink()} aria-label={copied ? "Room link copied" : "Copy room link"} title="Copy room link">
      {copied ? <>{!showCode && <Check size={16} />} Link copied</> : label}
    </button>
  );
}
