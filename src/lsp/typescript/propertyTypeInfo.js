export function resolveNeedlePropertyTypeInfo(ts2, languageService, fileName, position, metadata) {
  const program = languageService.getProgram();
  const sourceFile = program?.getSourceFile(fileName);
  if (!program || !sourceFile) return null;
  const checker = program.getTypeChecker();
  const node = findNeedleIdentifierAtPosition(ts2, sourceFile, position);
  if (!node) return null;
  const symbol = checker.getSymbolAtLocation(node);
  const type = checker.getTypeAtLocation(node);
  if (checker.typeToString(type) === "any") return null;
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  const tags = symbol?.getJsDocTags(checker) ?? [];
  return {
    packageName: metadata.packageName,
    packageVersion: metadata.packageVersion,
    moduleName: metadata.moduleName,
    ownerType: declaration ? getNeedleOwningTypeName(ts2, declaration) : metadata.typeName,
    name: metadata.propertyName ?? node.getText(sourceFile),
    type: checker.typeToString(type),
    readonly: declaration ? hasNeedleReadonlyModifier(ts2, declaration) : void 0,
    optional: !!declaration && "questionToken" in declaration && !!declaration.questionToken,
    description: symbol ? ts2.displayPartsToString(symbol.getDocumentationComment(checker)) || void 0 : void 0,
    defaultValue: getNeedleDefaultValue(tags),
    sourceUrl: declaration?.getSourceFile().fileName,
    enumOptions: getNeedleLiteralEnumOptions(ts2, checker, type, program, declaration),
    container: getNeedleContainerTypeInfo(ts2, checker, type),
    constructor: getNeedleConstructorTypeInfo(ts2, checker, type),
    objectMembers: getNeedleObjectMemberTypeInfo(ts2, checker, type)
  };
}
function findNeedleIdentifierAtPosition(ts2, sourceFile, position) {
  let result;
  const visit = (node) => {
    if (result) return;
    if (ts2.isIdentifier(node) && node.getStart(sourceFile) <= position && position <= node.getEnd()) {
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
function getNeedleDefaultValue(tags) {
  const tag = tags.find((tag2) => tag2.name === "default" || tag2.name === "defaultValue");
  const text = tag?.text?.map((part) => part.text).join("").trim();
  return text?.replace(/^`|`$/g, "") || void 0;
}
function getNeedleLiteralEnumOptions(ts2, checker, type, program, declaration) {
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
  if (!typeNode || !ts2.isTypeReferenceNode(typeNode)) return void 0;
  const symbol = checker.getSymbolAtLocation(typeNode.typeName);
  const target = symbol && (symbol.flags & ts2.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  const aliasDeclaration = target?.declarations?.find(ts2.isTypeAliasDeclaration);
  if (!aliasDeclaration) return void 0;
  const options = getNeedleLiteralEnumOptionsFromTypeNode(ts2, checker, aliasDeclaration.type);
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
function getNeedleLiteralEnumOptionsFromProgramAlias(ts2, checker, program, typeName) {
  if (!/^[A-Za-z_$][\w$]*$/.test(typeName)) return void 0;
  for (const sourceFile of program.getSourceFiles()) {
    let result;
    const visit = (node) => {
      if (result) return;
      if (ts2.isTypeAliasDeclaration(node) && node.name.text === typeName && ts2.isUnionTypeNode(node.type)) {
        const options = getNeedleLiteralEnumOptionsFromTypeNode(ts2, checker, node.type);
        if (options.length > 0) result = options;
        return;
      }
      ts2.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (result) return result;
  }
  return void 0;
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
function getNeedleContainerTypeInfo(ts2, checker, type) {
  const normalizedType = getNeedleNonNullishType(ts2, type);
  const typeArguments = checker.getTypeArguments(normalizedType);
  if (checker.isArrayType(normalizedType) || checker.isTupleType(normalizedType)) {
    const elementType = typeArguments[0];
    if (!elementType) return { kind: "array" };
    return {
      kind: "array",
      elementType: checker.typeToString(elementType),
      elementTypeName: getNeedleTypeName(elementType),
      elementConstructor: getNeedleConstructorTypeInfo(ts2, checker, elementType),
      elementMembers: getNeedleObjectMemberTypeInfo(ts2, checker, elementType)
    };
  }
  const symbolName = getNeedleTypeSymbolName(normalizedType);
  if ((symbolName === "Set" || symbolName === "ReadonlySet") && typeArguments[0]) {
    const elementType = typeArguments[0];
    return {
      kind: "set",
      elementType: checker.typeToString(elementType),
      elementTypeName: getNeedleTypeName(elementType),
      elementConstructor: getNeedleConstructorTypeInfo(ts2, checker, elementType),
      elementMembers: getNeedleObjectMemberTypeInfo(ts2, checker, elementType)
    };
  }
  if ((symbolName === "Map" || symbolName === "ReadonlyMap") && typeArguments[1]) {
    const valueType = typeArguments[1];
    return {
      kind: "map",
      keyType: typeArguments[0] ? checker.typeToString(typeArguments[0]) : void 0,
      valueType: checker.typeToString(valueType),
      valueTypeName: getNeedleTypeName(valueType),
      valueConstructor: getNeedleConstructorTypeInfo(ts2, checker, valueType),
      valueMembers: getNeedleObjectMemberTypeInfo(ts2, checker, valueType)
    };
  }
  const stringIndexType = normalizedType.getStringIndexType();
  if (stringIndexType) {
    return {
      kind: "object",
      keyType: "string",
      valueType: checker.typeToString(stringIndexType),
      valueTypeName: getNeedleTypeName(stringIndexType),
      valueConstructor: getNeedleConstructorTypeInfo(ts2, checker, stringIndexType),
      valueMembers: getNeedleObjectMemberTypeInfo(ts2, checker, stringIndexType)
    };
  }
  return void 0;
}
function getNeedleObjectMemberTypeInfo(ts2, checker, type, depth = 0) {
  if (depth > 4) return void 0;
  const normalizedType = getNeedleNonNullishType(ts2, type);
  if ((normalizedType.getFlags() & ts2.TypeFlags.Object) === 0) return void 0;
  if (checker.isArrayType(normalizedType) || checker.isTupleType(normalizedType)) return void 0;
  const symbolName = getNeedleTypeSymbolName(normalizedType);
  if (symbolName === "Map" || symbolName === "ReadonlyMap" || symbolName === "Set" || symbolName === "ReadonlySet") return void 0;
  if (normalizedType.getStringIndexType()) return void 0;
  const symbols = checker.getPropertiesOfType(normalizedType).filter((symbol) => {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    const parent = declaration?.parent;
    return !!parent && (ts2.isTypeLiteralNode(parent) || ts2.isInterfaceDeclaration(parent));
  });
  if (symbols.length <= 0) return void 0;
  const members = symbols.map((symbol) => {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) return void 0;
    const memberType = getNeedleNonNullishType(ts2, checker.getTypeOfSymbolAtLocation(symbol, declaration));
    const name = symbol.getName();
    if (!name || name === "__type") return void 0;
    return {
      name,
      type: checker.typeToString(memberType),
      readonly: hasNeedleReadonlyModifier(ts2, declaration),
      optional: (symbol.flags & ts2.SymbolFlags.Optional) !== 0,
      constructor: getNeedleConstructorTypeInfo(ts2, checker, memberType),
      objectMembers: getNeedleObjectMemberTypeInfo(ts2, checker, memberType, depth + 1)
    };
  }).filter(Boolean);
  return members.length > 0 ? members : void 0;
}
function getNeedleConstructorTypeInfo(ts2, checker, type) {
  const normalizedType = getNeedleNonNullishType(ts2, type);
  const typeName = getNeedleTypeName(normalizedType);
  if (!typeName) return void 0;
  const constructorType = getNeedleConstructorTypeForInstanceType(checker, normalizedType);
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
  return nonNullish[0] ?? type;
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
