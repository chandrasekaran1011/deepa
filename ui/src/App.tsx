import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AlertCircle, Paperclip, Square, X, ArrowUp } from 'lucide-react';
import { ChatThread } from './components/ChatThread';
import { SettingsBar } from './components/SettingsBar';
import { SessionPanel } from './components/SessionPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { BottomControls } from './components/BottomControls';
import { SlashCommandPicker, SLASH_COMMANDS, getSlashQuery } from './components/SlashCommandPicker';
import type { SlashCommand } from './components/SlashCommandPicker';
import { useAgent } from './hooks/useAgent';

interface Attachment {
  id: string;
  file: File;
  preview?: string;
  type: 'image' | 'file';
}

function App() {
  const { messages, sendMessage, isProcessing, error, stopProcessing, sessionId, newSession, loadSession, pendingConfirmation, respondToConfirmation, tokenUsage } = useAgent();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSessions, setShowSessions] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0);
  // Slash command picker state
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
  }, [input]);

  const addAttachment = useCallback((file: File, type: 'image' | 'file') => {
    if (attachments.length >= 5) return;
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const att: Attachment = { id, file, type };

    if (type === 'image') {
      const reader = new FileReader();
      reader.onload = (e) => {
        att.preview = e.target?.result as string;
        setAttachments((prev) => [...prev, att]);
      };
      reader.readAsDataURL(file);
    } else {
      setAttachments((prev) => [...prev, att]);
    }
  }, [attachments.length]);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0)) return;

    sendMessage(input.trim() || 'Describe this.', attachments.map(a => a.file));
    setInput('');
    setAttachments([]);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const q = getSlashQuery(val);
    setSlashQuery(q);
    setSlashIndex(0);
  };

  const filteredCommands = slashQuery !== null
    ? SLASH_COMMANDS.filter(cmd => {
        const q = slashQuery.toLowerCase();
        return !q || cmd.command.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q) || (cmd.group?.toLowerCase().includes(q) ?? false);
      })
    : [];

  const handleSlashSelect = (cmd: SlashCommand) => {
    // Replace the last line (which starts with /) with the chosen command + a space
    const lines = input.split('\n');
    lines[lines.length - 1] = cmd.usage ?? cmd.command;
    // Add trailing space so user can keep typing args
    const newVal = lines.join('\n') + ' ';
    setInput(newVal);
    setSlashQuery(null);
    setSlashIndex(0);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When slash picker is open, hijack Up/Down/Enter/Esc
    if (slashQuery !== null && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex(i => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSlashSelect(filteredCommands[slashIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addAttachment(file, 'image');
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const file = e.dataTransfer.files[i];
      const type = file.type.startsWith('image/') ? 'image' : 'file';
      addAttachment(file, type);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const type = file.type.startsWith('image/') ? 'image' : 'file';
      addAttachment(file, type);
    }
    e.target.value = '';
  };

  return (
    <div
      className={`flex flex-col h-screen bg-[var(--bg)] text-[var(--text)] ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Settings Bar */}
      <SettingsBar
        onToggleSessions={() => { setShowSessions(!showSessions); setShowSettings(false); }}
      />

      {/* Session Panel */}
      <SessionPanel
        isOpen={showSessions}
        onClose={() => setShowSessions(false)}
        currentSessionId={sessionId}
        onNewSession={newSession}
        onLoadSession={loadSession}
      />

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => { setShowSettings(false); setSettingsRefreshKey(k => k + 1); }}
      />

      {/* Error Banner */}
      {error && (
        <div className="px-6 py-2 flex items-center gap-2 text-sm bg-[var(--red)]/10 text-[var(--red)] border-b border-[var(--red)]/20">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Chat Thread */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full">
          <ChatThread messages={messages} isProcessing={isProcessing} pendingConfirmation={pendingConfirmation} onConfirmResponse={respondToConfirmation} />
          <div ref={bottomRef} className="h-8" />
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-[var(--border)] bg-[var(--bg)]">
        <div className="max-w-4xl mx-auto px-2 xs:px-4 py-2 xs:py-3">
          {/* Attachment Preview */}
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="relative group flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs"
                >
                  {att.preview ? (
                    <img src={att.preview} alt="" className="w-8 h-8 rounded object-cover" />
                  ) : (
                    <Paperclip size={12} className="text-[var(--text-muted)]" />
                  )}
                  <span className="text-[var(--text-secondary)] max-w-[120px] truncate">{att.file.name}</span>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="ml-1 text-[var(--text-muted)] hover:text-[var(--red)] transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            {/* Paperclip Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors shrink-0 mb-0.5"
              title="Attach file"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.txt,.ts,.tsx,.js,.jsx,.json,.md,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.toml,.sh,.bash"
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Input + Slash Picker */}
            <div className="flex-1 relative">
              {/* Slash command picker — floats above the textarea */}
              {slashQuery !== null && filteredCommands.length > 0 && (
                <SlashCommandPicker
                  query={slashQuery}
                  selectedIndex={slashIndex}
                  onSelect={handleSlashSelect}
                  onClose={() => setSlashQuery(null)}
                />
              )}

              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={isProcessing ? 'Queue another message...' : 'Message Deepa... (/ for commands)'}
                className="w-full min-h-[44px] xs:min-h-[52px] py-2.5 xs:py-3 px-3 xs:px-4 bg-[var(--bg-input)] border border-[var(--border)] rounded-xl resize-none focus:outline-none focus:border-[var(--accent)]/50 text-[var(--text)] placeholder:text-[var(--text-muted)] text-sm transition-colors leading-relaxed"
                rows={1}
                style={{ overflowY: 'auto' }}
              />
            </div>

            {/* Send / Stop Buttons */}
            <div className="flex items-center gap-1 mb-0.5">
              {isProcessing && (
                <button
                  type="button"
                  onClick={stopProcessing}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--red)]/15 text-[var(--red)] hover:bg-[var(--red)]/25 transition-colors shrink-0"
                  title="Stop execution"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              )}
              <button
                type="submit"
                disabled={!input.trim() && attachments.length === 0}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Send message (Enter) · New line (Shift+Enter)"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </div>
          </form>

          <BottomControls
            onToggleSettings={() => { setShowSettings(!showSettings); setShowSessions(false); }}
            refreshKey={settingsRefreshKey}
            tokenUsage={tokenUsage}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
