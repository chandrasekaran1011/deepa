import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, ShieldCheck, ShieldX, MessageSquare, User, Bot, ListChecks, Check, X } from 'lucide-react';
import type { ChatMessage, ToolCall } from '../hooks/useAgent';

interface ChatThreadProps {
    messages: ChatMessage[];
    isProcessing: boolean;
    pendingConfirmation?: {
        description: string;
        type: 'action' | 'plan';
        planItems?: { content: string; status: string }[];
    } | null;
    onConfirmResponse?: (response: 'allow' | 'deny' | string) => void;
}

// ─── Tool display helpers ───

const TOOL_VERBS: Record<string, { done: string; pending: string }> = {
    file_read: { done: 'Read', pending: 'Reading...' },
    file_write: { done: 'Wrote', pending: 'Writing...' },
    file_edit: { done: 'Edited', pending: 'Editing...' },
    file_list: { done: 'Listed', pending: 'Listing...' },
    shell: { done: 'Ran', pending: 'Running...' },
    search_grep: { done: 'Searched', pending: 'Searching...' },
    search_files: { done: 'Searched', pending: 'Searching...' },
    web_fetch: { done: 'Fetched', pending: 'Fetching...' },
    web_search: { done: 'Searched', pending: 'Searching...' },
    todo: { done: 'Updated', pending: 'Updating tasks...' },
    git_worktree: { done: 'Worktree', pending: 'Creating worktree...' },
    use_skill: { done: 'Skill', pending: 'Loading skill...' },
};

function getToolLabel(call: ToolCall): { verb: string; arg: string } {
    const info = TOOL_VERBS[call.name] || { done: call.name, pending: `${call.name}...` };
    const verb = call.status === 'pending' ? info.pending : info.done;

    let arg = '';
    const args = call.args || {};
    if (args.path) {
        const parts = String(args.path).split('/');
        arg = parts[parts.length - 1];
        if (parts.length > 1) {
            arg = parts.slice(-2).join('/');
        }
    } else if (args.command) {
        arg = String(args.command).length > 60
            ? String(args.command).slice(0, 60) + '…'
            : String(args.command);
    } else if (args.pattern) {
        arg = `"${args.pattern}"`;
    } else if (args.query) {
        arg = `"${args.query}"`;
    } else if (args.url) {
        try {
            arg = new URL(String(args.url)).hostname;
        } catch {
            arg = String(args.url).slice(0, 40);
        }
    } else if (call.name === 'todo') {
        arg = 'tasks';
    }

    return { verb, arg };
}

function getResultLineCount(result: string): number {
    return result.split('\n').length;
}

// ─── Components ───

export const ChatThread: React.FC<ChatThreadProps> = ({ messages, isProcessing, pendingConfirmation, onConfirmResponse }) => {
    return (
        <div className="py-6 px-4 space-y-0">
            {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-[var(--text-muted)] space-y-3">
                    <div className="text-4xl opacity-30">◆</div>
                    <p className="text-sm">Send a message to get started</p>
                </div>
            ) : (
                messages.map((msg) => (
                    <MessageEntry key={msg.id} message={msg} />
                ))
            )}

            {/* Confirmation / Plan Approval Card */}
            {pendingConfirmation && onConfirmResponse && (
                pendingConfirmation.type === 'plan' && pendingConfirmation.planItems ? (
                    <PlanApprovalCard
                        planItems={pendingConfirmation.planItems}
                        onResponse={onConfirmResponse}
                    />
                ) : (
                    <ConfirmCard
                        description={pendingConfirmation.description}
                        onResponse={onConfirmResponse}
                    />
                )
            )}

            {isProcessing && !pendingConfirmation && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="flex items-center gap-3 py-3 px-3">
                    <div className="w-6 h-6 rounded-full bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                        <Bot size={13} className="text-[var(--accent)]" />
                    </div>
                    <span className="spinner text-[var(--text-muted)] text-sm">✱</span>
                    <span className="text-[var(--text-muted)] text-sm">Thinking...</span>
                </div>
            )}
        </div>
    );
};

// ─── Message Entry ───

const MessageEntry: React.FC<{ message: ChatMessage }> = ({ message }) => {
    // System message (e.g. "User interrupted and stopped execution.")
    if (message.role === 'system') {
        return (
            <div className="flex items-center gap-2 py-2 px-3 mx-2 my-2">
                <div className="flex-1 border-b border-[var(--yellow)]/30" />
                <span className="text-xs text-[var(--yellow)] font-medium px-2">{message.content}</span>
                <div className="flex-1 border-b border-[var(--yellow)]/30" />
            </div>
        );
    }

    const isUser = message.role === 'user';

    if (isUser) {
        return (
            <div className={`mt-5 mb-3 ${message.isQueued ? 'opacity-60' : ''}`}>
                {/* User header */}
                <div className="flex items-center gap-2 px-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-[var(--text-muted)]/20 flex items-center justify-center shrink-0">
                        <User size={13} className="text-[var(--text-secondary)]" />
                    </div>
                    <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">You</span>
                    {message.isQueued && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--yellow)]/15 text-[var(--yellow)] font-medium">
                            Queued
                        </span>
                    )}
                </div>
                {/* User message body */}
                <div className="py-2 px-3 ml-8 text-[var(--text)] text-sm whitespace-pre-wrap leading-relaxed">
                    {message.content}
                </div>
                {/* Attachment thumbnails */}
                {message.attachments && message.attachments.length > 0 && (
                    <div className="flex gap-2 px-3 ml-8 pb-1">
                        {message.attachments.map((att, i) => (
                            <div key={i} className="w-16 h-16 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
                                {att.preview ? (
                                    <img src={att.preview} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-[10px]">
                                        {att.name}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {/* Separator */}
                <div className="mx-2 mt-2 border-b border-[var(--border)]/50" />
            </div>
        );
    }

    // Assistant message
    return (
        <div className="py-1">
            {/* Tool calls — shown as flat lines, with only the latest todo card visible */}
            {message.toolCalls && message.toolCalls.length > 0 && (() => {
                const lastTodoIdx = (() => {
                    for (let i = message.toolCalls!.length - 1; i >= 0; i--) {
                        if (message.toolCalls![i].name === 'todo') return i;
                    }
                    return -1;
                })();

                return (
                    <div className="space-y-0.5">
                        {message.toolCalls!.map((call, idx) => {
                            if (call.name === 'todo' && idx !== lastTodoIdx) return null;
                            return <ToolLine key={call.id} call={call} />;
                        })}
                    </div>
                );
            })()}

            {/* Assistant text with markdown */}
            {message.content && (
                <div className="py-2 px-2">
                    <div className={`prose-dark text-sm leading-relaxed ${message.isStreaming ? 'streaming-cursor' : ''}`}>
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                        >
                            {message.content}
                        </ReactMarkdown>
                    </div>
                </div>
            )}

            {/* Streaming with no content yet */}
            {!message.content && message.isStreaming && !message.toolCalls?.length && (
                <div className="flex items-center gap-3 py-2 px-2">
                    <span className="spinner text-[var(--text-muted)] text-sm">✱</span>
                    <span className="text-[var(--text-muted)] text-sm">Thinking...</span>
                </div>
            )}

            {/* End-of-response indicator — shown when assistant is done and has content */}
            {!message.isStreaming && message.content && (
                <div className="mx-2 mt-1 mb-2 flex items-center gap-2">
                    <div className="flex-1 border-b border-[var(--border)]/30" />
                    <span className="text-[10px] text-[var(--text-muted)]/60 shrink-0">◆</span>
                    <div className="flex-1 border-b border-[var(--border)]/30" />
                </div>
            )}
        </div>
    );
};

// ─── Todo Card ───

interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm?: string;
}

const TodoCard: React.FC<{ call: ToolCall }> = ({ call }) => {
    const todos: TodoItem[] = call.args?.todos || [];
    if (todos.length === 0) return null;

    const completed = todos.filter(t => t.status === 'completed').length;
    const total = todos.length;
    const inProgress = todos.find(t => t.status === 'in_progress');
    const allDone = completed === total;
    const title = allDone ? 'All tasks completed' : (inProgress?.activeForm || inProgress?.content || 'Update Todos');

    return (
        <div className="my-2 mx-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
            {/* Header with progress bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
                <span className={`text-sm ${allDone ? 'text-[var(--green)]' : call.status === 'pending' ? 'text-[var(--text-muted)]' : 'text-[var(--accent)]'}`}>
                    {allDone ? '✓' : '●'}
                </span>
                <span className={`font-bold text-sm ${allDone ? 'text-[var(--green)]' : 'text-[var(--text)]'}`}>{title}</span>
                {total > 0 && (
                    <span className="ml-auto text-[10px] text-[var(--text-muted)]">{completed}/{total}</span>
                )}
            </div>

            {/* Progress bar */}
            {total > 0 && (
                <div className="h-0.5 bg-[var(--border)]">
                    <div
                        className={`h-full transition-all duration-500 ease-out ${allDone ? 'bg-[var(--green)]' : 'bg-[var(--accent)]'}`}
                        style={{ width: `${(completed / total) * 100}%` }}
                    />
                </div>
            )}

            {/* Todo items */}
            <div className="px-3 py-2 space-y-1">
                {todos.map((todo, i) => (
                    <div key={i} className="flex items-start gap-2 py-0.5">
                        {todo.status === 'completed' ? (
                            <span className="shrink-0 mt-0.5 w-4 h-4 rounded border border-[var(--green)] bg-[var(--green)]/20 flex items-center justify-center text-[var(--green)] text-[10px]">✓</span>
                        ) : todo.status === 'in_progress' ? (
                            <span className="shrink-0 mt-0.5 spinner text-[var(--accent)] text-sm">✱</span>
                        ) : (
                            <span className="shrink-0 mt-0.5 w-4 h-4 rounded border border-[var(--border)] bg-transparent" />
                        )}
                        <span className={`text-sm leading-snug ${
                            todo.status === 'completed'
                                ? 'line-through text-[var(--text-muted)]'
                                : todo.status === 'in_progress'
                                    ? 'text-[var(--text)] font-medium'
                                    : 'text-[var(--text-secondary)]'
                        }`}>
                            {todo.content}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Confirm Card ───

const ConfirmCard: React.FC<{
    description: string;
    onResponse: (response: 'allow' | 'deny' | string) => void;
}> = ({ description, onResponse }) => {
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedback, setFeedback] = useState('');

    const handleFeedbackSubmit = () => {
        if (feedback.trim()) {
            onResponse(feedback.trim());
        }
    };

    const lines = description.split('\n');
    const truncatedDesc = lines.length > 8
        ? lines.slice(0, 8).join('\n') + '\n...'
        : description;

    return (
        <div className="my-2 mx-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--accent)]/20">
                <ShieldCheck size={14} className="text-[var(--accent)]" />
                <span className="font-bold text-sm text-[var(--text)]">Action requires approval</span>
            </div>

            <div className="px-3 py-2">
                <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words font-mono leading-relaxed max-h-32 overflow-y-auto">
                    {truncatedDesc}
                </pre>
            </div>

            <div className="px-3 py-2 border-t border-[var(--accent)]/20">
                {!showFeedback ? (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onResponse('allow')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--green)]/15 text-[var(--green)] hover:bg-[var(--green)]/25 transition-colors text-xs font-medium"
                        >
                            <ShieldCheck size={12} />
                            Allow
                        </button>
                        <button
                            onClick={() => onResponse('deny')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--red)]/15 text-[var(--red)] hover:bg-[var(--red)]/25 transition-colors text-xs font-medium"
                        >
                            <ShieldX size={12} />
                            Deny
                        </button>
                        <button
                            onClick={() => setShowFeedback(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors text-xs font-medium"
                        >
                            <MessageSquare size={12} />
                            Edit
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleFeedbackSubmit()}
                            placeholder="Provide feedback..."
                            className="flex-1 px-3 py-1.5 rounded-md bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text)] text-xs focus:outline-none focus:border-[var(--accent)]/50"
                            autoFocus
                        />
                        <button
                            onClick={handleFeedbackSubmit}
                            disabled={!feedback.trim()}
                            className="px-3 py-1.5 rounded-md bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25 transition-colors text-xs font-medium disabled:opacity-40"
                        >
                            Send
                        </button>
                        <button
                            onClick={() => setShowFeedback(false)}
                            className="px-3 py-1.5 rounded-md bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors text-xs"
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Plan Approval Card ───

const PlanApprovalCard: React.FC<{
    planItems: { content: string; status: string }[];
    onResponse: (response: 'allow' | 'deny' | string) => void;
}> = ({ planItems, onResponse }) => {
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedback, setFeedback] = useState('');

    const handleFeedbackSubmit = () => {
        if (feedback.trim()) {
            onResponse(feedback.trim());
        }
    };

    return (
        <div className="my-3 mx-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--accent)]/20">
                <ListChecks size={15} className="text-[var(--accent)]" />
                <span className="font-bold text-sm text-[var(--text)]">Plan</span>
                <span className="text-xs text-[var(--text-muted)] ml-auto">{planItems.length} steps</span>
            </div>

            {/* Plan steps */}
            <div className="px-4 py-3 space-y-1.5">
                {planItems.map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 flex items-center justify-center text-[10px] font-bold text-[var(--accent)] mt-0.5">
                            {i + 1}
                        </span>
                        <span className="text-sm text-[var(--text)] leading-snug">{item.content}</span>
                    </div>
                ))}
            </div>

            {/* Actions */}
            <div className="px-4 py-2.5 border-t border-[var(--accent)]/20 bg-[var(--bg-card)]/50">
                {!showFeedback ? (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onResponse('allow')}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--green)]/15 text-[var(--green)] hover:bg-[var(--green)]/25 transition-colors text-xs font-medium"
                        >
                            <Check size={12} />
                            Approve
                        </button>
                        <button
                            onClick={() => onResponse('deny')}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--red)]/15 text-[var(--red)] hover:bg-[var(--red)]/25 transition-colors text-xs font-medium"
                        >
                            <X size={12} />
                            Reject
                        </button>
                        <button
                            onClick={() => setShowFeedback(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors text-xs font-medium"
                        >
                            <MessageSquare size={12} />
                            Edit
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleFeedbackSubmit()}
                            placeholder="Suggest changes to the plan..."
                            className="flex-1 px-3 py-1.5 rounded-md bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text)] text-xs focus:outline-none focus:border-[var(--accent)]/50"
                            autoFocus
                        />
                        <button
                            onClick={handleFeedbackSubmit}
                            disabled={!feedback.trim()}
                            className="px-3 py-1.5 rounded-md bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25 transition-colors text-xs font-medium disabled:opacity-40"
                        >
                            Send
                        </button>
                        <button
                            onClick={() => setShowFeedback(false)}
                            className="px-3 py-1.5 rounded-md bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors text-xs"
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Tool Line ───

const ToolLine: React.FC<{ call: ToolCall }> = ({ call }) => {
    if (call.name === 'todo') {
        return <TodoCard call={call} />;
    }

    const [isExpanded, setIsExpanded] = useState(false);
    const { verb, arg } = getToolLabel(call);
    const isPending = call.status === 'pending';

    return (
        <div>
            <button
                onClick={() => !isPending && setIsExpanded(!isExpanded)}
                className="flex items-center gap-3 py-1.5 px-2 w-full text-left hover:bg-[var(--bg-card)]/50 rounded transition-colors group"
                disabled={isPending}
            >
                {isPending ? (
                    <span className="spinner text-[var(--text-muted)] text-sm shrink-0">✱</span>
                ) : (
                    <span className={`text-sm shrink-0 ${call.status === 'error' ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>●</span>
                )}

                <span className="font-bold text-sm text-[var(--text)]">{verb}</span>

                {arg && <span className="text-sm text-[var(--text-secondary)] truncate">{arg}</span>}

                {!isPending && call.result && (
                    <span className="ml-auto text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                )}

                {!isPending && call.result && !isExpanded && (
                    <span className="ml-auto text-[10px] text-[var(--text-muted)] shrink-0">
                        [{getResultLineCount(call.result)} lines]
                    </span>
                )}
            </button>

            {isExpanded && call.result && (
                <div className="ml-7 mb-2">
                    <pre className={`p-3 rounded-lg text-xs overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap ${
                        call.status === 'error'
                            ? 'bg-[var(--red)]/5 text-[var(--red)] border border-[var(--red)]/20'
                            : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border)]'
                    }`}>
                        {call.result}
                    </pre>
                </div>
            )}
        </div>
    );
};

// ─── Markdown Components ───

const markdownComponents = {
    table: ({ children }: any) => (
        <div className="overflow-x-auto my-3 rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">{children}</table>
        </div>
    ),
    thead: ({ children }: any) => (
        <thead className="bg-[var(--bg-card)]">{children}</thead>
    ),
    th: ({ children }: any) => (
        <th className="px-4 py-2 text-left font-semibold border-b border-[var(--border)] text-[var(--text-secondary)]">{children}</th>
    ),
    td: ({ children }: any) => (
        <td className="px-4 py-2 border-b border-[var(--border)]">{children}</td>
    ),
    tr: ({ children }: any) => (
        <tr className="even:bg-[var(--bg-card)] hover:bg-[var(--bg-input)] transition-colors">{children}</tr>
    ),
    code: ({ className, children, ...props }: any) => {
        const isInline = !className;
        return isInline
            ? <code className="px-1.5 py-0.5 rounded bg-[var(--bg-input)] text-[var(--accent)] text-[13px] font-mono">{children}</code>
            : <code className={`${className || ''} font-mono`} {...props}>{children}</code>;
    },
    pre: ({ children }: any) => (
        <pre className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 overflow-x-auto my-3 text-sm font-mono">{children}</pre>
    ),
    a: ({ children, href }: any) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">{children}</a>
    ),
    h1: ({ children }: any) => <h1 className="text-lg font-bold text-[var(--text)] mt-4 mb-2">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-base font-bold text-[var(--text)] mt-3 mb-2">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-sm font-bold text-[var(--text)] mt-3 mb-1">{children}</h3>,
    p: ({ children }: any) => <p className="mb-2 text-[var(--text)]">{children}</p>,
    ul: ({ children }: any) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
    li: ({ children }: any) => <li className="text-[var(--text)]">{children}</li>,
    blockquote: ({ children }: any) => (
        <blockquote className="border-l-2 border-[var(--accent)] pl-4 my-2 text-[var(--text-secondary)] italic">{children}</blockquote>
    ),
    hr: () => <hr className="border-[var(--border)] my-4" />,
};
