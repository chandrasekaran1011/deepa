/**
 * Truncates a string to a maximum length, appending a warning message if truncated.
 * useful for preventing large tool outputs from blowing up the LLM context window.
 */
export function truncateOutput(text: string, maxLength: number = 40000): string {
    if (text.length <= maxLength) {
        return text;
    }
    const truncated = text.slice(0, maxLength);
    return `${truncated}\n\n[...Truncated: Output exceeded ${maxLength} characters. Use specific line ranges or grep to inspect further...]`;
}
