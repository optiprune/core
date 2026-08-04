/**
 * Shared AST Utilities for Yuku-compatible ESTree ASTs.
 * Replaces @babel/types for common type-guarding tasks.
 */

export const t = {
  isStringLiteral: (n: unknown): n is { type: "Literal"; value: string } =>
    !!n && typeof n === 'object' && (n as any).type === 'Literal' && typeof (n as any).value === 'string',
  
  isNumericLiteral: (n: unknown): n is { type: "Literal"; value: number } =>
    !!n && typeof n === 'object' && (n as any).type === 'Literal' && typeof (n as any).value === 'number',
  
  isBooleanLiteral: (n: unknown): n is { type: "Literal"; value: boolean } =>
    !!n && typeof n === 'object' && (n as any).type === 'Literal' && typeof (n as any).value === 'boolean',
  
  isIdentifier: (n: unknown): n is { type: "Identifier"; name: string } =>
    !!n && typeof n === 'object' && (n as any).type === 'Identifier',
  
  isCallExpression: (n: unknown): n is { type: "CallExpression"; callee: any; arguments: any[] } =>
    !!n && typeof n === 'object' && (n as any).type === 'CallExpression',
  
  isMemberExpression: (n: unknown): n is { type: "MemberExpression"; object: any; property: any; computed: boolean } =>
    !!n && typeof n === 'object' && (n as any).type === 'MemberExpression',
  
  isVariableDeclarator: (n: unknown): n is { type: "VariableDeclarator"; id: any; init: any } =>
    !!n && typeof n === 'object' && (n as any).type === 'VariableDeclarator',
  
  isFunctionDeclaration: (n: unknown): n is { type: "FunctionDeclaration"; id: { name: string } | null } =>
    !!n && typeof n === 'object' && (n as any).type === 'FunctionDeclaration',
  
  isExportNamedDeclaration: (n: unknown): n is { type: "ExportNamedDeclaration"; declaration: any; specifiers: any[] } =>
    !!n && typeof n === 'object' && (n as any).type === 'ExportNamedDeclaration',
  
  isImportDeclaration: (n: unknown): n is { type: "ImportDeclaration"; source: { value: string }; specifiers: any[] } =>
    !!n && typeof n === 'object' && (n as any).type === 'ImportDeclaration',
  
  isObjectProperty: (n: unknown): n is { type: "Property"; key: any; value: any; computed: boolean } =>
    !!n && typeof n === 'object' && ((n as any).type === 'Property' || (n as any).type === 'ObjectProperty'),
  
  isObjectMethod: (n: unknown): n is { type: "ObjectMethod"; key: any } =>
    !!n && typeof n === 'object' && (n as any).type === 'ObjectMethod',
  
  isTSInterfaceDeclaration: (n: unknown): n is { type: "TSInterfaceDeclaration"; id: { name: string } } =>
    !!n && typeof n === 'object' && (n as any).type === 'TSInterfaceDeclaration',
  
  isTSTypeAliasDeclaration: (n: unknown): n is { type: "TSTypeAliasDeclaration"; id: { name: string } } =>
    !!n && typeof n === 'object' && (n as any).type === 'TSTypeAliasDeclaration',
  
  isTSEnumDeclaration: (n: unknown): n is { type: "TSEnumDeclaration"; id: { name: string } } =>
    !!n && typeof n === 'object' && (n as any).type === 'TSEnumDeclaration',
  
  isClassDeclaration: (n: unknown): n is { type: "ClassDeclaration"; id: { name: string } | null } =>
    !!n && typeof n === 'object' && (n as any).type === 'ClassDeclaration',
  
  isClassExpression: (n: unknown): n is { type: "ClassExpression"; id: { name: string } | null } =>
    !!n && typeof n === 'object' && (n as any).type === 'ClassExpression',
  
  isClassMethod: (n: unknown): n is { type: "ClassMethod"; key: any } =>
    !!n && typeof n === 'object' && (n as any).type === 'ClassMethod',
  
  isClassProperty: (n: unknown): n is { type: "ClassProperty"; key: any } =>
    !!n && typeof n === 'object' && ((n as any).type === 'ClassProperty' || (n as any).type === 'PropertyDefinition'),
  
  isExportDefaultDeclaration: (n: unknown): n is { type: "ExportDefaultDeclaration"; declaration: any } =>
    !!n && typeof n === 'object' && (n as any).type === 'ExportDefaultDeclaration',
  
  isFunctionExpression: (n: unknown): n is { type: "FunctionExpression"; id: { name: string } | null } =>
    !!n && typeof n === 'object' && (n as any).type === 'FunctionExpression',
  
  isJSXElement: (n: unknown): n is { type: "JSXElement"; openingElement: any } =>
    !!n && typeof n === 'object' && (n as any).type === 'JSXElement',
  
  isJSXIdentifier: (n: unknown): n is { type: "JSXIdentifier"; name: string } =>
    !!n && typeof n === 'object' && (n as any).type === 'JSXIdentifier',

  isObjectExpression: (n: unknown): n is { type: "ObjectExpression"; properties: any[] } =>
    !!n && typeof n === 'object' && (n as any).type === 'ObjectExpression',
  
  isLiteral: (n: unknown): n is { type: "Literal"; value: any } =>
    !!n && typeof n === 'object' && (n as any).type === 'Literal',
  
  isJSXAttribute: (n: unknown): n is { type: "JSXAttribute"; name: any; value: any } =>
    !!n && typeof n === 'object' && (n as any).type === 'JSXAttribute',
  
  isNewExpression: (n: unknown): n is { type: "NewExpression"; callee: any; arguments: any[] } =>
    !!n && typeof n === 'object' && (n as any).type === 'NewExpression',
  
  isTemplateLiteral: (n: unknown): n is { type: "TemplateLiteral"; quasis: any[]; expressions: any[] } =>
    !!n && typeof n === 'object' && (n as any).type === 'TemplateLiteral',

  isDecorator: (n: unknown): n is { type: "Decorator"; expression: any } =>
    !!n && typeof n === 'object' && (n as any).type === 'Decorator',
};
