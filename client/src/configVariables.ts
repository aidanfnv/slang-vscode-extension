import * as vscode from 'vscode';

function getWorkspaceFolder(scopeUri?: string): vscode.WorkspaceFolder | undefined {
	if (scopeUri) {
		try {
			const uri = vscode.Uri.parse(scopeUri);
			const folder = vscode.workspace.getWorkspaceFolder(uri);
			if (folder) {
				return folder;
			}
			// Valid URI, but not mapped to a workspace folder (for example untitled:/virtual URIs).
			// Continue to the single-root fallback below.
		} catch {
			// Ignore invalid scope URI and fall back to workspace-level behavior below.
		}
	}

	// Some workspace/configuration requests are window-scoped and do not carry a scope URI.
	// In a single-root workspace, using the lone folder preserves expected ${workspaceFolder} expansion.
	const folders = vscode.workspace.workspaceFolders;
	if (folders && folders.length === 1) {
		return folders[0];
	}

	// In no-folder or multi-root workspaces, leave ${workspaceFolder}-style variables unresolved.
	return undefined;
}

function getProcessLike(): NodeJS.Process | undefined {
	return typeof process !== 'undefined' ? process : undefined;
}

function resolvePathSeparator(scopeUri?: string): string {
	const workspaceFolder = getWorkspaceFolder(scopeUri);
	if (workspaceFolder?.uri.fsPath.includes('\\')) {
		return '\\';
	}
	const proc = getProcessLike();
	return proc?.platform === 'win32' ? '\\' : '/';
}

function resolveVariable(variableName: string, scopeUri?: string): string | undefined {
	const workspaceFolder = getWorkspaceFolder(scopeUri);
	// Handle built-in variables with exact names.
	switch (variableName) {
		case 'workspaceFolder':
		case 'workspaceRoot':
			return workspaceFolder?.uri.fsPath;
		case 'workspaceFolderBasename':
		case 'workspaceRootFolderName':
			return workspaceFolder?.name;
		case 'pathSeparator':
			return resolvePathSeparator(scopeUri);
		case 'userHome': {
			const proc = getProcessLike();
			return proc?.env.HOME ?? proc?.env.USERPROFILE;
		}
		case 'cwd': {
			const proc = getProcessLike();
			return proc?.cwd ? proc.cwd() : undefined;
		}
		default:
			break;
	}

	// Handle variables that encode an argument after a prefix, e.g. ${env:HOME}.
	if (variableName.startsWith('workspaceFolder:')) {
		const folderName = variableName.slice('workspaceFolder:'.length);
		return vscode.workspace.workspaceFolders?.find(folder => folder.name === folderName)?.uri.fsPath;
	}
	if (variableName.startsWith('env:')) {
		const envName = variableName.slice('env:'.length);
		const proc = getProcessLike();
		return proc?.env[envName];
	}
	if (variableName.startsWith('config:')) {
		const settingName = variableName.slice('config:'.length);
		// Resolve config values against the provided scope URI when available.
		let scope: vscode.Uri | undefined;
		if (scopeUri) {
			try {
				scope = vscode.Uri.parse(scopeUri);
			} catch {
				scope = undefined;
			}
		}
		const settingValue = vscode.workspace.getConfiguration(undefined, scope).get<string>(settingName);
		return settingValue;
	}
	return undefined;
}

export function expandVscodeVariables(value: string, scopeUri?: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (match, variableName) => {
		const resolvedValue = resolveVariable(variableName, scopeUri);
		return resolvedValue === undefined ? match : resolvedValue;
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function expandSlangSettingsInConfiguration(value: unknown, section?: string, scopeUri?: string): unknown {
	if (section === 'slang.additionalSearchPaths' && Array.isArray(value)) {
		return value.map(path => typeof path === 'string' ? expandVscodeVariables(path, scopeUri) : path);
	}
	if (section !== 'slang' || !isRecord(value)) {
		return value;
	}

	const expandedSlangConfig: Record<string, unknown> = { ...value };
	if (Array.isArray(expandedSlangConfig.additionalSearchPaths)) {
		expandedSlangConfig.additionalSearchPaths = expandedSlangConfig.additionalSearchPaths.map(path =>
			typeof path === 'string' ? expandVscodeVariables(path, scopeUri) : path
		);
	}
	return expandedSlangConfig;
}
