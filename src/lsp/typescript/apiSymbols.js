/** Query the worker's existing program; never create a second resolver or program. */
export function queryApiSymbols(ts, service, uri, options = {}) {
    const program = service.getProgram();
    const source = program?.getSourceFile(uri);
    const checker = program?.getTypeChecker();
    const statement = source?.statements.find(node => ts.isImportDeclaration(node));
    const module = statement && checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (!module) return { status: 'unresolved', diagnostics: service.getSemanticDiagnostics(uri).map(value => ts.flattenDiagnosticMessageText(value.messageText, '\n')).slice(0, 8) };
    const limit = Math.max(1, Math.min(60, options.limit ?? 30));
    const exports = checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name));
    const unalias = symbol => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const typeOf = symbol => symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)
        ? checker.getDeclaredTypeOfSymbol(symbol)
        : checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? symbol.declarations?.[0] ?? source);
    const names = symbols => symbols.slice(0, limit).map(symbol => ({ name: symbol.name }));
    if (!options.symbol) return { status: 'resolved', exports: names(exports), total: exports.length, truncated: exports.length > limit };
    const parts = options.symbol.split('.');
    let symbol = exports.find(value => value.name === parts[0]);
    if (!symbol) return { status: 'not-found', symbol: options.symbol, exports: names(exports), total: exports.length, truncated: exports.length > limit };
    symbol = unalias(symbol);
    for (const part of parts.slice(1)) {
        const staticMember = checker.getPropertyOfType(typeOf(symbol), part);
        const instanceType = symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface) ? checker.getDeclaredTypeOfSymbol(symbol) : undefined;
        symbol = staticMember ?? (instanceType && checker.getPropertyOfType(instanceType, part));
        if (!symbol) return { status: 'not-found', symbol: options.symbol };
        symbol = unalias(symbol);
    }
    const type = typeOf(symbol);
    const instanceType = symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface) ? checker.getDeclaredTypeOfSymbol(symbol) : type;
    const members = checker.getPropertiesOfType(instanceType).sort((a, b) => a.name.localeCompare(b.name));
    const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
    let remaining = 16000;
    let truncated = members.length > limit || signatures.length > limit;
    const text = value => {
        const result = String(value).slice(0, Math.max(0, Math.min(4000, remaining)));
        remaining -= result.length;
        if (result.length < String(value).length) truncated = true;
        return result;
    };
    const result = {
        status: 'resolved', symbol: options.symbol,
        type: text(checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)),
        signatures: signatures.slice(0, limit).map(value => text(checker.signatureToString(value, undefined, ts.TypeFormatFlags.NoTruncation))),
        documentation: text(ts.displayPartsToString(symbol.getDocumentationComment(checker))),
        tags: symbol.getJsDocTags(checker).slice(0, limit).map(tag => ({ name: tag.name, text: text(ts.displayPartsToString(tag.text)) })),
        definitions: (symbol.declarations ?? []).slice(0, limit).map(node => {
            const file = node.getSourceFile();
            const location = file.getLineAndCharacterOfPosition(node.getStart());
            return { uri: file.fileName, line: location.line + 1, column: location.character + 1 };
        }),
        members: names(members), memberCount: members.length,
    };
    return { ...result, truncated };
}
