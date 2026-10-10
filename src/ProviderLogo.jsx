import React from 'react';
import codex from '../website/assets/codex.svg';
import claude from '../website/assets/claude.svg';
import github from '../website/assets/github.svg';

const logos = { codex, claude, github };

export default function ProviderLogo({ provider, size = 18 }) {
  const src = logos[provider];
  if (!src) return null;
  return (
    <img
      className="provider-logo"
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  );
}

export function AgentMark({ agent }) {
  return (
    <span className={`agent-mark ${agent}`} aria-hidden="true">
      <ProviderLogo provider={agent} size={agent === 'claude' ? 19 : 24} />
    </span>
  );
}
