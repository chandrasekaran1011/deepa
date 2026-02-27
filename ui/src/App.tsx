import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AlertCircle, Paperclip, Square, X } from 'lucide-react';
import { ChatThread } from './components/ChatThread';
import { SettingsBar } from './components/SettingsBar';
import { SessionPanel } from './components/SessionPanel';
import { useAgent } from './hooks/useAgent';

interface Attachment {
  id: string;
  file: File;
  preview?: string;
  type: 'image' | 'file';
}

function App() {
  const { messages, sendMessage, isProcessing, error, stopProcessing, queueSize, sessionId, newSession, loadSession, pendingConfirmation, respondToConfirmation } = useAgent();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      <SettingsBar onToggleSessions={() => setShowSessions(!showSessions)} />

      {/* Session Panel */}
      <SessionPanel
        isOpen={showSessions}
        onClose={() => setShowSessions(false)}
        currentSessionId={sessionId}
        onNewSession={newSession}
        onLoadSession={loadSession}
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
        <div className="max-w-4xl mx-auto">
          <ChatThread messages={messages} isProcessing={isProcessing} pendingConfirmation={pendingConfirmation} onConfirmResponse={respondToConfirmation} />
          <div ref={bottomRef} className="h-8" />
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-[var(--border)] bg-[var(--bg)]">
        <div className="max-w-4xl mx-auto px-4 py-3">
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
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
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

            {/* Input */}
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={isProcessing ? 'Queue another message...' : 'Message Deepa...'}
                className="w-full max-h-32 min-h-[44px] py-3 px-4 bg-[var(--bg-input)] border border-[var(--border)] rounded-xl resize-none focus:outline-none focus:border-[var(--accent)]/50 text-[var(--text)] placeholder:text-[var(--text-muted)] text-sm transition-colors"
                rows={1}
              />
              {queueSize > 0 && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded-full">
                  {queueSize} queued
                </span>
              )}
            </div>

            {/* Stop Button */}
            {isProcessing && (
              <button
                type="button"
                onClick={stopProcessing}
                className="p-2 text-[var(--red)] hover:bg-[var(--red)]/10 rounded-lg transition-colors shrink-0"
                title="Stop processing"
              >
                <Square size={18} fill="currentColor" />
              </button>
            )}
          </form>

          <div className="text-center mt-1.5 text-[10px] text-[var(--text-muted)]">
            Enter to send · Shift+Enter new line · Ctrl+V paste image · Drag files to attach
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
