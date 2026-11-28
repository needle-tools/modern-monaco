export function resolveNeedlePropertyTypeInfo(ts2, languageService, fileName, position, metadata) {
  const program = languageService.getProgram();
  const sourceFile = program?.getSourceFile(fileName);
  if (!program || !sourceFile) return null;
  const checker = program.getTypeChecker();
  const node = findNeedleIdentifierAtPosition(ts2, sourceFile, position);
  if (!node) return null;
  const symbol = checker.getSymbolAtLocation(node);
  const typeNode = ts2.isStringLiteral(node) && ts2.isElementAccessExpression(node.parent) ? node.parent : node;
  const type = checker.getTypeAtLocation(typeNode);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  const checkedTypeText = checker.typeToString(type);
  const declaredTypeText = declaration && "type" in declaration ? declaration.type?.getText() : void 0;
  const typeText = checkedTypeText === "any" && declaredTypeText && declaredTypeText !== "any" ? declaredTypeText : checkedTypeText;
  if (typeText === "any") return null;
  const tags = symbol?.getJsDocTags(checker) ?? [];
  return {
    packageName: metadata.packageName,
    packageVersion: metadata.packageVersion,
    moduleName: metadata.moduleName,
    ownerType: declaration ? getNeedleOwningTypeName(ts2, declaration) || metadata.typeName : metadata.typeName,
    name: metadata.propertyName ?? node.getText(sourceFile),
    type: typeText,
    readonly: declaration ? hasNeedleReadonlyModifier(ts2, declaration) : void 0,
    optional: !!declaration && "questionToken" in declaration && !!declaration.questionToken,
    description: symbol ? ts2.displayPartsToString(symbol.getDocumentationComment(checker)) || void 0 : void 0,
    defaultValue: getNeedleDefaultValue(tags),
    stringFormat: getNeedleStringFormat(tags),
    ...getNeedlePresentation(tags, typeText),
    sourceUrl: declaration?.getSourceFile().fileName,
    enumOptions: getNeedleLiteralEnumOptions(ts2, checker, type, program, declaration),
    container: getNeedleContainerTypeInfo(ts2, checker, type, program),
    constructor: getNeedleConstructorTypeInfo(ts2, checker, type),
    constructorOptions: getNeedleConstructorTypeOptions(ts2, checker, type),
    unionOptions: getNeedleUnionTypeInfo(ts2, checker, type, program),
    objectMembers: getNeedleObjectMemberTypeInfo(ts2, checker, type, program)
  };
}
function findNeedleIdentifierAtPosition(ts2, sourceFile, position) {
  let result;
  const visit = (node) => {
    if (result) return;
    const isPropertyToken = ts2.isIdentifier(node)
      || (ts2.isStringLiteral(node) && ts2.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node);
    if (isPropertyToken && node.getStart(sourceFile) <= position && position <= node.getEnd()) {
      result = node;
      return;
    }
    ts2.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}
function getNeedleOwningTypeName(ts2, declaration) {
  let current = declaration.parent;
  while (current) {
    if ((ts2.isClassDeclaration(current) || ts2.isInterfaceDeclaration(current)) && current.name) return current.name.text;
    current = current.parent;
  }
  return "";
}
function hasNeedleReadonlyModifier(ts2, declaration) {
  return ts2.canHaveModifiers(declaration) ? ts2.getModifiers(declaration)?.some((modifier) => modifier.kind === ts2.SyntaxKind.ReadonlyKeyword) ?? false : false;
}
function getNeedleStringFormat(tags) {
  const text = tags.find(tag => tag.name === "format")?.text?.map(part => part.text).join("").trim();
  return text === "url" ? "url" : void 0;
}
function getNeedlePresentation(tags, type) {
  const text = name => tags.find(tag => tag.name === name)?.text?.map(part => part.text).join("").trim();
  const presentation = {};
  if (/(?:^|\s\|\s)string(?:$|\s\|\s)/.test(type)) {
    const accept = text("accept");
    if (accept && accept.split(",").every(value => /^[\w.+-]+\/(?:[\w.+-]+|\*)$/.test(value.trim()))) presentation.accept = accept;
  }
  if (/(?:^|\s\|\s)number(?:$|\s\|\s)/.test(type)) {
    const unit = text("unit");
    if (unit && unit.length <= 16 && !/[\r\n]/.test(unit)) presentation.unit = unit;
    const range = text("range")?.split(/\s+/);
    if (range?.length === 2) {
      const [min, max] = range.map(Number);
      if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
        presentation.min = min;
        presentation.max = max;
      }
    }
  }
  return presentation;
}
function getNeedleDefaultValue(tags) {
  const tag = tags.find((tag2) => tag2.name === "default" || tag2.name === "defaultValue");
  const text = tag?.text?.map((part) => part.text).join("").trim();
  return text?.replace(/^`|`$/g, "") || void 0;
}
function getNeedleLiteralEnumOptions(ts2, checker, type, program, declaration) {
  if (type.isUnion() && type.types.some(part => (part.flags & (ts2.TypeFlags.String | ts2.TypeFlags.Number | ts2.TypeFlags.Object | ts2.TypeFlags.Any | ts2.TypeFlags.Unknown)) !== 0)) return void 0;
  const declarationOptions = getNeedleLiteralEnumOptionsFromDeclaration(ts2, checker, declaration);
  if (declarationOptions?.length) return declarationOptions;
  const aliasOptions = getNeedleLiteralEnumOptionsFromAliasDeclaration(ts2, checker, type);
  if (aliasOptions?.length) return aliasOptions;
  if (!type.isUnion()) return void 0;
  const options = type.types.map((part) => {
    const value = part.value;
    return typeof value === "string" || typeof value === "number" ? { label: String(value), value } : void 0;
  }).filter(Boolean);
  if (options.length > 0) return options;
  return getNeedleLiteralEnumOptionsFromProgramAlias(ts2, checker, program, checker.typeToString(type));
}
function getNeedleLiteralEnumOptionsFromDeclaration(ts2, checker, declaration) {
  const typeNode = declaration && "type" in declaration ? declaration.type : void 0;
  if (!typeNode) return void 0;
  const options = getNeedleLiteralEnumOptionsFromTypeNode(ts2, checker, typeNode);
  return options.length > 0 ? options : void 0;
}
function getNeedleLiteralEnumOptionsFromAliasDeclaration(ts2, checker, type) {
  const declaration = [
    ...type.aliasSymbol?.declarations ?? [],
    ...type.getSymbol()?.declarations ?? []
  ].find(ts2.isTypeAliasDeclaration);
  if (!declaration) return void 0;
  const options = getNeedleLiteralEnumOptionsFromTypeNode(ts2, checker, declaration.type);
  return options.length > 0 ? options : void 0;
}
const unionAliasesByProgram = new WeakMap();

function getNeedleLiteralEnumOptionsFromProgramAlias(ts2, checker, program, typeName) {
  if (!/^[A-Za-z_$][\w$]*$/.test(typeName) || typeName === "boolean") return void 0;
  let aliases = unionAliasesByProgram.get(program);
  if (!aliases) {
    aliases = new Map();
    const visit = node => {
      if (ts2.isTypeAliasDeclaration(node) && ts2.isUnionTypeNode(node.type)) {
        const name = node.name.text;
        const declarations = aliases.get(name);
        if (declarations) declarations.push(node.type);
        else aliases.set(name, [node.type]);
      }
      ts2.forEachChild(node, visit);
    };
    for (const file of program.getSourceFiles()) visit(file);
    unionAliasesByProgram.set(program, aliases);
  }
  for (const declaration of aliases.get(typeName) ?? []) {
    const options = getNeedleLiteralEnumOptionsFromTypeNode(ts2, checker, declaration);
    if (options.length) return options;
  }
}
function getNeedleLiteralEnumOptionsFromTypeNode(ts2, checker, typeNode, seen = /* @__PURE__ */ new Set()) {
  if (ts2.isUnionTypeNode(typeNode)) {
    return uniqueNeedleEnumOptions(typeNode.types.flatMap((entry) => getNeedleLiteralEnumOptionsFromTypeNode(ts2, checker, entry, seen)));
  }
  if (typeof ts2.isParenthesizedTypeNode === "function" && ts2.isParenthesizedTypeNode(typeNode)) {
    return getNeedleLiteralEnumOptionsFromTypeNode(ts2, checker, typeNode.type, seen);
  }
  if (ts2.isTypeReferenceNode(typeNode)) {
    const symbol = checker.getSymbolAtLocation(typeNode.typeName);
    const target = symbol && (symbol.flags & ts2.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
    const options = [];
    for (const declaration of target?.declarations ?? []) {
      if (ts2.isEnumDeclaration(declaration)) {
        options.push(...declaration.members.map((member) => {
          const value = checker.getConstantValue(member);
          if (typeof value !== "string" && typeof value !== "number") return void 0;
          const label = ts2.isIdentifier(member.name) || ts2.isStringLiteral(member.name) || ts2.isNumericLiteral(member.name) ? member.name.text : member.name.getText();
          return { label, value };
        }).filter(Boolean));
        continue;
      }
      if (!ts2.isTypeAliasDeclaration(declaration)) continue;
      const key = `${declaration.getSourceFile().fileName}:${declaration.pos}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(...getNeedleLiteralEnumOptionsFromTypeNode(ts2, checker, declaration.type, seen));
    }
    if (options.length > 0) return uniqueNeedleEnumOptions(options);
  }
  const option = getNeedleLiteralEnumOptionFromTypeNode(ts2, checker, typeNode);
  return option ? [option] : [];
}
function uniqueNeedleEnumOptions(options) {
  const seen = /* @__PURE__ */ new Set();
  return options.filter((option) => {
    const key = `${option.label}:${option.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function getNeedleLiteralEnumOptionFromTypeNode(ts2, checker, typeNode) {
  if (ts2.isTypeQueryNode(typeNode)) {
    const type = checker.getTypeFromTypeNode(typeNode);
    const value = getNeedleLiteralTypeValue(type);
    return value === void 0 ? void 0 : { label: typeNode.exprName.getText(), value };
  }
  const type = checker.getTypeFromTypeNode(typeNode);
  const value = getNeedleLiteralTypeValue(type);
  return value === void 0 ? void 0 : { label: String(value), value };
}
function getNeedleLiteralTypeValue(type) {
  const value = type.value;
  return typeof value === "string" || typeof value === "number" ? value : void 0;
}
function getNeedleContainerTypeInfo(ts2, checker, type, program, depth = 0, seen = /* @__PURE__ */ new Set()) {
  const normalizedType = getNeedleNonNullishType(ts2, type);
  const typeArguments = checker.getTypeArguments(normalizedType);
  const symbolName = getNeedleTypeSymbolName(normalizedType);
  if (checker.isArrayType(normalizedType) || checker.isTupleType(normalizedType) || symbolName === "ReadonlyArray") {
    const elementType = typeArguments[0];
    if (!elementType) return { kind: "array" };
    return {
      kind: "array",
      readonly: symbolName === "ReadonlyArray" || normalizedType.target?.readonly === true,
      elementType: checker.typeToString(elementType),
      elementTypeName: getNeedleTypeName(elementType),
      elementConstructor: getNeedleConstructorTypeInfo(ts2, checker, elementType),
      elementOptions: getNeedleUnionTypeInfo(ts2, checker, elementType, program, depth + 1, seen),
      elementMembers: getNeedleObjectMemberTypeInfo(ts2, checker, elementType, program, depth + 1, seen)
    };
  }
  if ((symbolName === "Set" || symbolName === "ReadonlySet") && typeArguments[0]) {
    const elementType = typeArguments[0];
    return {
      kind: "set",
      readonly: symbolName === "ReadonlySet",
      elementType: checker.typeToString(elementType),
      elementTypeName: getNeedleTypeName(elementType),
      elementConstructor: getNeedleConstructorTypeInfo(ts2, checker, elementType),
      elementOptions: getNeedleUnionTypeInfo(ts2, checker, elementType, program, depth + 1, seen),
      elementMembers: getNeedleObjectMemberTypeInfo(ts2, checker, elementType, program, depth + 1, seen)
    };
  }
  if ((symbolName === "Map" || symbolName === "ReadonlyMap") && typeArguments[1]) {
    const valueType = typeArguments[1];
    return {
      kind: "map",
      readonly: symbolName === "ReadonlyMap",
      keyType: typeArguments[0] ? checker.typeToString(typeArguments[0]) : void 0,
      keyMembers: typeArguments[0] ? getNeedleObjectMemberTypeInfo(ts2, checker, typeArguments[0], program, depth + 1, seen) : void 0,
      keyConstructor: typeArguments[0] ? getNeedleConstructorTypeInfo(ts2, checker, typeArguments[0]) : void 0,
      valueType: checker.typeToString(valueType),
      valueTypeName: getNeedleTypeName(valueType),
      valueConstructor: getNeedleConstructorTypeInfo(ts2, checker, valueType),
      valueOptions: getNeedleUnionTypeInfo(ts2, checker, valueType, program, depth + 1, seen),
      valueMembers: getNeedleObjectMemberTypeInfo(ts2, checker, valueType, program, depth + 1, seen)
    };
  }
  const stringIndexType = normalizedType.getStringIndexType();
  if (stringIndexType) {
    return {
      kind: "object",
      readonly: checker.getIndexInfosOfType(normalizedType).some(info => info.isReadonly),
      keyType: "string",
      valueType: checker.typeToString(stringIndexType),
      valueTypeName: getNeedleTypeName(stringIndexType),
      valueConstructor: getNeedleConstructorTypeInfo(ts2, checker, stringIndexType),
      valueOptions: getNeedleUnionTypeInfo(ts2, checker, stringIndexType, program, depth + 1, seen),
      valueMembers: getNeedleObjectMemberTypeInfo(ts2, checker, stringIndexType, program, depth + 1, seen)
    };
  }
  return void 0;
}
function getNeedleObjectMemberTypeInfo(ts2, checker, type, program, depth = 0, seen = /* @__PURE__ */ new Set()) {
  if (depth > 6) return void 0;
  const normalizedType = getNeedleNonNullishType(ts2, type);
  const objectFlags = ts2.TypeFlags.Object | ts2.TypeFlags.Intersection;
  if ((normalizedType.getFlags() & objectFlags) === 0) return void 0;
  if (checker.isArrayType(normalizedType) || checker.isTupleType(normalizedType)) return void 0;
  const symbolName = getNeedleTypeSymbolName(normalizedType);
  if (symbolName === "Map" || symbolName === "ReadonlyMap" || symbolName === "Set" || symbolName === "ReadonlySet") return void 0;
  if (normalizedType.getStringIndexType()) return void 0;
  if (isNeedleDefaultLibraryType(normalizedType)
    && !(normalizedType.objectFlags & ts2.ObjectFlags.Mapped)) return void 0;
  const typeKey = checker.typeToString(normalizedType);
  if (seen.has(typeKey)) return void 0;
  const branchSeen = new Set(seen);
  branchSeen.add(typeKey);
  const symbols = checker.getPropertiesOfType(normalizedType).filter((symbol) => {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    const parent = declaration?.parent;
    return !!declaration && !!parent
      && (ts2.isPropertyDeclaration(declaration) || ts2.isPropertySignature(declaration))
      && !(ts2.canHaveModifiers(declaration) && ts2.getModifiers(declaration)?.some((modifier) => modifier.kind === ts2.SyntaxKind.PrivateKeyword || modifier.kind === ts2.SyntaxKind.ProtectedKeyword))
      && (ts2.isTypeLiteralNode(parent) || ts2.isInterfaceDeclaration(parent) || ts2.isClassDeclaration(parent));
  });
  if (symbols.length <= 0) return void 0;
  const members = symbols.map((symbol) => {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) return void 0;
    const declaredMemberType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const memberType = getNeedleNonNullishType(ts2, declaredMemberType);
    const name = symbol.getName();
    if (!name || name === "__type") return void 0;
    const optional = (symbol.flags & ts2.SymbolFlags.Optional) !== 0;
    const checkedTypeText = checker.typeToString(declaredMemberType);
    const declaredTypeText = "type" in declaration ? declaration.type?.getText() : void 0;
    const typeText = checkedTypeText === "any" && declaredTypeText && declaredTypeText !== "any" ? declaredTypeText : checkedTypeText;
    const tags = symbol.getJsDocTags(checker);
    return {
      name,
      type: typeText,
      readonly: hasNeedleReadonlyModifier(ts2, declaration),
      optional,
      omitWhenOptional: optional,
      stringFormat: getNeedleStringFormat(tags),
      ...getNeedlePresentation(tags, typeText),
      description: ts2.displayPartsToString(symbol.getDocumentationComment(checker)) || void 0,
      enumOptions: getNeedleLiteralEnumOptions(ts2, checker, memberType, program, declaration),
      container: getNeedleContainerTypeInfo(ts2, checker, memberType, program, depth + 1, branchSeen),
      constructor: getNeedleConstructorTypeInfo(ts2, checker, memberType),
      constructorOptions: getNeedleConstructorTypeOptions(ts2, checker, memberType),
      unionOptions: getNeedleUnionTypeInfo(ts2, checker, declaredMemberType, program, depth + 1, branchSeen),
      objectMembers: getNeedleObjectMemberTypeInfo(ts2, checker, memberType, program, depth + 1, branchSeen)
    };
  }).filter(Boolean);
  return members.length > 0 ? members : void 0;
}
function getNeedleUnionTypeInfo(ts2, checker, type, program, depth = 0, seen = new Set()) {
  if (depth > 6 || !type.isUnion()) return void 0;
  let parts = type.types;
  const boolean = parts.filter(part => (part.flags & ts2.TypeFlags.BooleanLiteral) !== 0);
  if (boolean.length === 2) parts = parts.filter(part => (part.flags & ts2.TypeFlags.BooleanLiteral) === 0);
  if (parts.length + (boolean.length === 2 ? 1 : 0) < 2) return void 0;
  return [...(boolean.length === 2 ? [{name: 'boolean', type: 'boolean'}] : []), ...parts.map(part => ({
    name: checker.typeToString(part), type: checker.typeToString(part),
    container: getNeedleContainerTypeInfo(ts2, checker, part, program, depth + 1, seen),
    constructor: getNeedleConstructorTypeInfo(ts2, checker, part),
    objectMembers: getNeedleObjectMemberTypeInfo(ts2, checker, part, program, depth + 1, seen),
  }))];
}
function isNeedleDefaultLibraryType(type) {
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  const declarations = symbol?.declarations ?? [];
  return declarations.length > 0 && declarations.every((declaration) => {
    const sourceFile = declaration.getSourceFile();
    return sourceFile.hasNoDefaultLib || /\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(sourceFile.fileName.replace(/\\/g, "/"));
  });
}
function getNeedleConstructorTypeInfo(ts2, checker, type) {
  const options = getNeedleConstructorTypes(ts2, checker, type);
  return options.length === 1 ? options[0] : void 0;
}
function getNeedleConstructorTypeOptions(ts2, checker, type) {
  const options = getNeedleConstructorTypes(ts2, checker, type);
  return options.length > 1 ? options : void 0;
}
function getNeedleConstructorTypes(ts2, checker, type) {
  const types = type.isUnion() ? type.types.filter((part) => (part.flags & (ts2.TypeFlags.Null | ts2.TypeFlags.Undefined | ts2.TypeFlags.Void)) === 0) : [type];
  const options = types.map((part) => getNeedleConstructorTypeInfoForSingleType(ts2, checker, part)).filter(Boolean);
  return [...new Map(options.map((option) => [option.typeName, option])).values()];
}
function getNeedleConstructorTypeInfoForSingleType(ts2, checker, type) {
  const typeName = getNeedleTypeName(type);
  if (!typeName) return void 0;
  const constructorType = getNeedleConstructorTypeForInstanceType(checker, type);
  if (!constructorType) return void 0;
  const signature = checker.getSignaturesOfType(constructorType, ts2.SignatureKind.Construct)[0];
  if (!signature) return void 0;
  return {
    typeName,
    parameters: signature.parameters.map((symbol) => {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      const parameterType = declaration ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : checker.getAnyType();
      const optional = !!declaration && ts2.isParameter(declaration) && !!declaration.questionToken;
      return {
        name: symbol.getName(),
        type: checker.typeToString(optional ? getNeedleNonNullishType(ts2, parameterType) : parameterType),
        optional,
        rest: !!declaration && ts2.isParameter(declaration) && !!declaration.dotDotDotToken
      };
    })
  };
}
function getNeedleConstructorTypeForInstanceType(checker, type) {
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  const declaration = symbol?.declarations?.[0];
  return symbol && declaration ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : void 0;
}
function getNeedleNonNullishType(ts2, type) {
  if (!type.isUnion()) return type;
  const nonNullish = type.types.filter((part) => (part.flags & (ts2.TypeFlags.Null | ts2.TypeFlags.Undefined | ts2.TypeFlags.Void)) === 0);
  return nonNullish.length === 1 ? nonNullish[0] : type;
}
function getNeedleTypeName(type) {
  const symbolName = getNeedleTypeSymbolName(type);
  if (symbolName && !isNeedleBuiltinContainerName(symbolName)) return symbolName;
  const aliasName = type.aliasSymbol?.getName();
  return aliasName && !isNeedleBuiltinContainerName(aliasName) ? aliasName : void 0;
}
function getNeedleTypeSymbolName(type) {
  return type.getSymbol()?.getName() ?? type.aliasSymbol?.getName();
}
function isNeedleBuiltinContainerName(name) {
  return name === "Array" || name === "ReadonlyArray" || name === "Map" || name === "ReadonlyMap" || name === "Set" || name === "ReadonlySet";
}
