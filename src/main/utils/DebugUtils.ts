export function printVisualSeparator(pattern: string = '=-') {
    if (process.env.NODE_ENV === 'production') return;

    const line = pattern.repeat(40);
    const separator = Array(5).fill(line).join('\n');
    process.stdout.write('\n' + separator + '\n');
}

export function printRequestStartSeparator() { printVisualSeparator('->'); }
export function printRequestEndSeparator() { printVisualSeparator('--'); }

export function printRespondStartSeparator() { printVisualSeparator('<-'); }
export function printRespondEndSeparator() { printVisualSeparator('=='); }
