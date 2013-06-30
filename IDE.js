process.on("uncaughtException", function(exception)
{
	console.warn("Clouds are annoying, y'all: ", exception.stack);
});

//webkit requirements
var aceRange = ace.require("ace/range").Range;
var aceCppMode = ace.require("ace/mode/c_cpp").Mode;
var AceEditSession = ace.require("ace/edit_session").EditSession;
var AceDocument = ace.require("ace/document").Document;
var AceRange = ace.require("ace/range").Range;

//node requirements
var fs = require("fs");
var Path = require("path");

__dirname = Path.dirname(unescape(window.location.pathname));

//relocate:
//  note: this function doesn't work the same way as the Node standard, as it prefers local modules
//    to built-in modules of the same name.  This shouldn't be a problem in practise.
require = (function()
{
	var R = window.require;
	var retry = function _require_retry(name)
	{
		var d = __dirname;
		while((d != Path.sep))
		{
			try{ return(R(Path.join(d, "node_modules", name))); }
			catch(e){ d = Path.dirname(d); }	//and try again
		}
		return(R(name));	//last chance: built-in
	};
	return(function _require(name)
	{
		if(name.substr(0, 1) == ".")
			try{ return(R(Path.join(__dirname, name))); }
			catch(e){ return(retry(name)); }
		else
			return(retry(name));
	});
})();

var CodeTalker = require("./codetalker");
var Config = require("./Config");
var Q = require("q");

//identify
var package = require("./package.json");


function setWindowTitle(projectName)
{
	var t = (projectName? (projectName + " - ") : "") + "Logiblock IDE " + package.version;
	if(gui.Window.get())
		gui.Window.get().title = t;
}


//why require("mkdirp") when you can implement it so elegantly?
function mkdirp(path, callback)
{
	var self = arguments.callee;
	fs.exists(path, function(exists)
	{
		if(!exists)
			self(Path.dirname(path), function(err)	//if it doesn't exist, ensure the parent does
			{
				if(err)	callback(err);
				else	fs.mkdir(path, callback);	//if the parent exists, create the child
			});
		else
			callback();
	});
};

//extremely basic asynchronous loop for an array
function loop(set, body, after)
{
	var i = -1, r;
	(function()
	{
		if(++i == set.length)	after(set, r);
		else					r = body(arguments.callee, set[i], i);
	})();
}

//returns an associative object of URL key-value pairs
function urlArguments(urlQuery)
{
	var parts = (urlQuery || window.location.search).substr(1).split("&"), o = {};

	for(var i in parts)
	{
		var p = parts[i].split("=");
		o[decodeURIComponent(p[0])] = (p.length > 1)? decodeURIComponent(p[1]) : undefined;
	}
	return(o);
}

//ls(), lsPromise(): generate an associative object tree from a directory (with lsPromise, as a promise)
//  options may contain:
//    filter: RegExp which must pass to include a file (default = /^[^.]/, hides hidden files)
//    showHidden: bool to show files and dirs that start with "." (default = false, hides these files)
//    hideEmpty: bool to prune empty directories (default = false, incde empty directories)
//    absolute: bool to return absolute paths rather than relative to the location specified by 'path'
function ls(path, options, callback)
{
	if(arguments.length == 2)
	{
		callback = options;
		options = {};
	}
	if(!options.filter)	options.filter = /^[^.]/;
	var recurse = function(absPath, relPath, options, callback)
	{
		var o = {}, cCount = 0;
		fs.readdir(absPath, function(err, files)
		{
			if(err)
			{
				if(err.code == "ENOTDIR")	return(callback(relPath.match(options.filter)? (options.absolute? absPath : relPath) : undefined));
				else						return(callback(err));
			}

			loop(files, function(next, file, i)
			{
				if((file.substr(0, 1) == ".") && !options.showHidden)	//early pruning of hidden dirs
					return(next());

				var sub = Path.join(absPath, file);
				var relSub = Path.join(relPath, file);
				recurse(sub, relSub, options, function(children)
				{
					if(children != undefined)
					{
						o[file] = children;
						cCount++;
					}
					next();
				});

			}, function()
			{
				callback((!cCount && options.hideEmpty)? undefined : o);
			});
		});
	};
	recurse(path, "", options, callback);
}
function lsPromise(path, options)
{
	var p = Q.defer();
	ls(path, options, function(o)
	{
		p.resolve(o);
	});
	return(p.promise);
}



File.prototype = _.extend(new Dagger.Object(),
{
	needsSave: function File_needsSave()
	{
		return(this._needsSave);
	},
	close: function File_close()
	{
		if(this._needsSave)
			this.save(true);
		if(this.document != undefined)
			this.document.removeEventListener("change", this._onChangeListener);
	},

	_onFileRead: function File__onFileRead(error, contents)
	{
		if(!error)
		{
			console.log("read file: ", this.path)
			this.contents = contents;

			this.trigger(new Dagger.Event(this, "load", {error: false}));
		}
		else if(error.code == "ENOENT")
		{
			//create a new file and fire the callback
			fs.writeFile(this.path, "", {encoding: "utf8"}, function(error)
			{
				this.trigger(new Dagger.Event(this, "load", {error: !!error}));
			}.bind(this));
		}	
		else
			this.trigger(new Dagger.Event(this, "load", {error: true}));
	},
	bind: function File_bind(aceSession)
	{
		this.session = aceSession;

		this.session.setValue(this.contents, {renderCall: true});

		this.document = this.session.getDocument();

		this.document.on("change", this._onChangeListener = function(e)
		{
			if(!this._needsSave)
				this.trigger(new Dagger.Event(this, "needsSave"));
			this._needsSave = true;
			
			this.save();
		}.bind(this));
	},
	save: function File_save(force)
	{
		if(this.document == undefined)
			return;

		var ths = this;
		this.contents = this.document.getValue();

		if(this._saveTimer)
			clearTimeout(this._saveTimer);

		if(force)
			this._doSave();
		else
			this._saveTimer = setTimeout(function()	//don't save until after shortly after the last call
			{
				ths._doSave();
			}, 2000);
	},

	_doSave: function File__doSave()
	{
		if(this._needsSave)
			this.trigger(new Dagger.Event(this, "save"));

		this._needsSave = false;

		console.log("will save '" + this.path + "' now.");
		fs.writeFile(this.path, this.contents, {encoding: "utf8"}, function(error)
		{
			if(error)
				console.warn("error, write to backup path?!", error);
		});
	}
});
function File(path)
{
	Dagger.Object.call(this);
	_.extend(this,
	{
		_needsSave: false,
		path: null,
		contents: null,
		session: null,
		document: null,
		path: path
	});

	if(path)
		fs.readFile(path, {encoding: "utf8"}, this._onFileRead.bind(this));
}

EditorView.prototype = _.extend(new Dagger.Object(),
{
	init: function EditorView_init(selector)
	{
		if(selector != undefined)
			this.selector = selector;

		if(this.selector == undefined)
			throw new Error("No selector specified, cannot initialize ACE.");

		this.editor = ace.edit($(this.selector)[0]);

		this.editor.on("guttermousedown", this.onToggleBreakpoint);
		
		with(this.editor)
		{
			setTheme("ace/theme/xcode");
			getSession().setMode(new aceCppMode());
			
			setBehavioursEnabled(false);
			setShowPrintMargin(false);
			setHighlightActiveLine(false);
			setSelectionStyle("line");
			session.setUseSoftTabs(false);
		}
	},
	
	deinit: function EditorView_deinit()
	{
		this.editor.removeEventListener("guttermousedown", this.onToggleBreakpoint);
	},

	open: function EditorView_open(path)
	{
		this.close();

		this.file = new File(path);

		this.file.listen("load", this._onOpen, this);
	},
	_onOpen: function EditorView__onOpen(event)
	{
		if(!event.error)
		{
			this.file.bind(this.editor.getSession());

			this.editor.setReadOnly(this.readOnly || (this.file == null));
			this.trigger(new Dagger.Event(this, "opened"));

			this.file.listen("save", function(e)
			{
				this.trigger(e);
			}, this);
		}
		else
		{
			this.close();
			console.warn("Error opening file!")
			this.editor.setReadOnly(this.readOnly || (this.file == null));
		}
	},

	close: function EditorView_close()
	{
		if(this.file != null)
		{
			this.file.ignore("load", this._onOpen, this);
			this.file.close();
			this.file = null;
		}

		//clear the editor
		this.editor.getSession().setValue("", {renderCall: true});
		this.editor.setReadOnly(this.readOnly || (this.file == null));
	},
	
	setReadOnly: function EditorView_setReadOnly(readOnly)
	{
		this.readOnly = readOnly;
		this.editor.setReadOnly(this.readOnly || (this.file == null));
	},
	getScrollOffset: function EditorView_getScrollOffset()
	{
		return(this.editor.getSession().getScrollTop());
	},
	setScrollOffset: function EditorView_setScrollOffset(offset)
	{
		this.editor.getSession().setScrollTop(offset);
	},
	jumpToLine: function EditorView_jumpToLine(lineNumber)
	{
		this.editor.scrollToLine(lineNumber, true);
	},
	
	addAnnotation: function EditorView_addAnnotation(file, line, type)
	{
		//ensure same file
		if(file != this.file.path)
			return;
		
		var style, gutter = false;
		switch(type)
		{
		case "breakpoint":				style = "ace_breakpoint";	gutter = true;	break;
		case "breakpointUnconfirmed":	style = "ace_breakpoint_unconfirmed";	gutter = true;	break;
		case "error":					style = "ide-line-error";	break;
		case "warning":					style = "ide-line-warning";	break;
		case "stopped":					style = "ide-line-stopped";	break;
		case "caller":					style = "ide-line-stopped-caller";	break;
		}
		
		if(gutter)
		{
			this.editor.session.setBreakpoint(line - 1, style);
		}
		else
		{
			this.editor.getSession().removeMarker(this.markers[line]);
			this.markers[line] = this.editor.getSession().addMarker(new AceRange(line - 1, 0, line, 0), style, "background");
		}
	},
	removeAnnotation: function EditorView_removeAnnotation(file, line, type)
	{
		//ensure same file
		if(file != this.file.path)
			return;

		switch(type)
		{
		case "breakpoint":
		case "breakpointUnconfirmed":
			this.editor.session.clearBreakpoint(line - 1);
			break;
		case "error":
		case "warning":
		case "stopped":
		case "caller":
			if(this.markers[line] != undefined)
			{
				this.editor.getSession().removeMarker(this.markers[line]);
				delete this.markers[line];
			}
			break;
		}
	},

	//clicking in the gutter requests a breakpoint, and an unrealized breakpoint is displayed.
	//  if the breakpoint becomes set, it is displayed as a proper breakpoint
	//  if that fails, the unrealized breakpoint is removed
	onToggleBreakpoint: function EditorView_onToggleBreakpoint(event)
	{
		var target = event.domEvent.target;
			
		if(!$(target).hasClass("ace_gutter-cell"))
			return;
		//if(!event.editor.isFocused())
		//	return;
		if(event.clientX > 25 + target.getBoundingClientRect().left)
			return;

		var row = event.getDocumentPosition().row;

		//note that lines are 1-indexed while rows are from 0
		this.trigger(new Dagger.Event(this, "toggleBreakpoint", {path: this.file.path, line: row + 1}));

		event.stop();
	},
});
function EditorView(selector)
{
	Dagger.Object.call(this);
	_.extend(this,
	{
		markers: {},
		file: null,
		editor: null,
		breakpoints: null,
		selector: null,
	});

	this.onToggleBreakpoint = this.onToggleBreakpoint.bind(this);
	if((this.selector = selector) != undefined)
		this.init();
}




TabView.prototype = _.extend(new Dagger.Object(),
{
	setData: function TabView_setData(data)
	{
		if(data == undefined)
			this.$el.children().not(".tabstart").remove();

		//um... @@refactor
	},

	_onFileSelected: function TabView__onFileChanged(event)
	{
		//find the child of $el that event.path refers to.
		//  if it doesn't exist, make one and insert it at the beginning
		//  else:
		//    if it's not entirely in the clipping rectangle of the container, move it to the beginning
		//    else select it

		if(event.path == undefined)
			return;

		if(this.$currentSelection)
			this.$currentSelection.removeClass("active");
		
		//find it
		var $f = this.$el.children('[data-path="' + event.path + '"]');
		if($f.length == 0)
		{
			//didn't find one, so create a new tab
			$f = $("<li/>");
			$f.html('<a href="#' + event.path + '">' + event.path.split("/").pop() + '</a>');
			$f.addClass("active");
			$f.attr("data-path", event.path);
			$f.attr("title", event.path);
			$f.insertAfter(this.$el.children(".tabstart"));
			this.$currentSelection = $f;

			$f.tooltip({html: true, placement: "bottom", trigger: "hover", delay: {show: 1000, hide: 100}});
		}
		else
		{
			//select the tab
			(this.$currentSelection = $f).addClass("active");

			//if not fully visible (allowing 10px margin of fuzziness)
			if($f[0].getBoundingClientRect().right > (this.$el[0].getBoundingClientRect().right + 10))
			{
				//move to front
				$f.insertAfter(this.$el.children(".tabstart"));
			}
		}

		//@@ trim children to some number higher than the max visible, like 25?
	},

	_onFileRemoved: function TabView__onFileRemoved(event)
	{
		this.$el.children('[data-path="' + event.path + '"]').remove();
	},

	_onTabClicked: function TabView__onTabClicked(event)
	{
		var $tab = $(event.target);

		var path = $tab.attr("href");
		if(path)
			this.trigger(new Dagger.Event(this, "selected", {path: path.substr(1)}));

		return(false);	//no browser navigation
	}
});
function TabView(selector, fileManager)
{
	Dagger.Object.call(this);
	_.extend(this,
	{
		$el: null,
		$currentSelection: null
	});
	this.$el = $(selector);
	this.$el.click(this._onTabClicked.bind(this));

	this.fileManager = fileManager;

	this.fileManager.listen("navigated", this._onFileSelected, this);
	this.fileManager.listen("removed", this._onFileRemoved, this);
}



//FileManager is the (incorrectly-named) Project object

FileManager.prototype = _.extend(new Dagger.Object(),
{
	needsSave: function FileManager_needsSave()
	{
		return(this._needsSave);
	},

	setEditor: function FileManager_setEditor(editor)
	{
		this.editor = editor;

		this.editor.listen("toggleBreakpoint", this.onBreakpointRequested, this);
		this.editor.listen("save", function(e)
		{
			this.trigger(new Dagger.Event(this, "projectUpdate", {path: this.projectPath}));
		}, this);
	},
	setFilesView: function FileManager_setFilesView(filesView)
	{
		this.filesView = filesView;

		this.filesView.listen("addFile", function(e)
		{
			this.showProjectFilesDialog();
		}, this);

		this.filesView.listen("selected", function(e)
		{
			this.navigate(e.index);
		}, this);
	},

	getProjectPath: function FileManager_getProjectPath()
	{
		return(this.projectPath);
	},

	openProject: function FileManager_openProject(projectPath)
	{
		this.closeProject();

		this.projectPath = projectPath;
		this.pathsTable.project = this.pathsTable.output = this.projectPath;

		fs.readFile(Path.join(this.projectPath, "module.json"), function(err, contents)
		{
			try
			{
				this.project = JSON.parse(contents);
			}
			catch(err)
			{
				this.closeProject();
			}

			var files = this.updateFilesView();

			if(files.length > 0)
				this.navigate(files[0].path);

			setWindowTitle(this.project.name);

		}.bind(this));
	},
	
	saveProject: function FileManager_saveProject(force)
	{
		if(this.editor && this.editor.file && this.editor.file.needsSave())
			this.editor.file.save(true);

		var ths = this;
		if((this.projectPath == undefined) || !this.project)
			return;

		if(this._saveTimer)
			clearTimeout(this._saveTimer);

		if(force)
			this._doSave();
		else
			this._saveTimer = setTimeout(function()	//don't save until after shortly after the last call
			{
				ths._doSave();
			}, 2000);
	},

	_doSave: function File__doSave()
	{
		if(this._needsSave)
			this.trigger(new Dagger.Event(this, "save"));

		this._needsSave = false;

		console.log("Saving project...");
		fs.writeFile(	Path.join(this.projectPath, "module.json"),
						JSON.stringify(this.project),
						{encoding: "utf8"},
						function(err)
		{
			console.log("Project saved.");
		});
	},
	closeProject: function FileManager_closeProject()
	{
		if(this._needsSave)
			this.saveProject(true);

		//close all tabs of files belonging to this project?

		this.project = undefined;
		this.projectPath = undefined;
		this.pathsTable.project = this.pathsTable.output = this.projectPath;
		this.filesView.setData();

		setWindowTitle();
	},

	//argument 'line' is optional
	navigate: function FileManager_navigate(path, line)
	{
		var f;

		if(path != this.currentPath)
		{
			if(this.currentPath)
			{
				this.removeAnnotations();

				this.filesByPath[this.currentPath].lastOffset = this.editor.getScrollOffset();
			}

			this.editor.close();

			this.currentPath = path;

			if(path)
			{
				f = this.filesByPath[path];
				if(f == undefined)	//the file isn't open yet
				{
					f = this.insertFile(this.currentPath);

					this.filesByLRU.unshift(f.path);
				}
				else
				{
					//update the access time and bump it to the head
					f.lastAccessed = Date.now();
					var off = this.filesByLRU.indexOf(f.path);
					if(off != -1)
						this.filesByLRU.splice(off, 1);
					this.filesByLRU.unshift(f.path);
				}
				this.editor.open(f.path);
				
				this.editor.listen("opened", function()
				{
					this.editor.ignore("opened", arguments.callee);
					
					this.editor.setScrollOffset(f.lastOffset);

					this.restoreAnnotations();

					if(line != undefined)
						this.editor.jumpToLine(line);
				}, this);
			}
			//else just close gracefully, as we can't open anything new
		}
		else
		{
			f = this.filesByPath[this.currentPath];

			if(line != undefined)
				this.editor.jumpToLine(line);
			
			this.restoreAnnotations();
		}

		this.filesView.setSelected(this.currentPath);	//ok if it doesn't match/select anything

		this.trigger(new Dagger.Event(this, "navigated", {path: this.currentPath}));
		this.trigger(new Dagger.Event(this, "changed"));
	},

	insertFile: function FileManager_insertFile(path, creationProperties)
	{
		if(this.filesByPath[path] != undefined)
			return(this.filesByPath[path]);

		return(this.filesByPath[path] = _.extend(
		{
			path: path,
			lastOffset: 0,
			lastAccessed: Date.now(),
			breakpoints: {},	//annotation in the gutter, keyed by unique line
			highlights: {}		//annotation in the text body, keyed by unique line
		}, creationProperties));
	},

	restoreAnnotations: function FileManager_restoreAnnotations()
	{
		var path = this.currentPath;

		for(var line in this.filesByPath[path].breakpoints)
			this.editor.addAnnotation(path, line, this.filesByPath[path].breakpoints[line]);

		for(var line in this.filesByPath[path].highlights)
		{
			var highlights = this.filesByPath[path].highlights[line];
			for(var i = 0; i < highlights.length; i++)
				this.editor.addAnnotation(path, line, highlights[i].type);
		}
	},
	removeAnnotations: function FileManager_removeAnnotations()
	{
		var path = this.currentPath;
		
		for(var line in this.filesByPath[path].breakpoints)
			this.editor.removeAnnotation(path, line, this.filesByPath[path].breakpoints[line]);

		for(var line in this.filesByPath[path].highlights)
		{
			var highlights = this.filesByPath[path].highlights[line];
			for(var i = 0; i < highlights.length; i++)
				this.editor.removeAnnotation(path, line, highlights[i].type);
		}
	},

	addBreakpoint: function FileManager_addBreakpoint(path, line, type)
	{
		var f = this.insertFile(path, {hidden: true});

		type = type || "breakpoint";
		f.breakpoints[line] = type;

		if(path == this.currentPath)
			this.editor.addAnnotation(path, line, type);
	},
	removeBreakpoint: function FileManager_removeBreakpoint(path, line)
	{
		var f = this.insertFile(path, {hidden: true});

		delete f.breakpoints[line];

		if(path == this.currentPath)
			this.editor.removeAnnotation(path, line, "breakpoint");
	},
	//type may be "caller" (callstack frame != 0) or "stopped" (callstack frame 0)
	addStackpoint: function FileManager_addStackpoint(path, line, type)
	{
		var f = this.insertFile(path, {hidden: true});

		(f.highlights[line] || (f.highlights[line] = [])).push({type: type});
		
		if(path == this.currentPath)
			this.editor.addAnnotation(path, line, type);
	},
	removeStackpoint: function FileManager_removeStackpoint(path, line)
	{
		var ths = this;
		var eachLine = function(path, line, highlights)
		{
			for(var i = 0; i < highlights.length; i++)
			{
				var type = highlights[i].type;
				if((type == "caller") || (type == "stopped"))
					highlights.splice(i, 1);
				if(path == ths.currentPath)
					ths.editor.removeAnnotation(path, line, type);
			}
		};
		var eachPath = function(path, highlights)
		{
			if(line != undefined)
			{
				if(highlights[line])
					eachLine(path, line, highlights[line]);
			}
			else
				for(var l in highlights)
					eachLine(path, l, highlights[l]);
		}

		if(path != undefined)
		{
			if(this.filesByPath[path])
				eachPath(path, this.filesByPath[path].highlights);
		}
		else
			for(var p in this.filesByPath)
				eachPath(p, this.filesByPath[p].highlights);
	},

	onBreakpointRequested: function FileManager_onBreakpointRequested(event)
	{
		if(event.path != this.currentPath)
			return;

		var f = this.insertFile(event.path);

		if(f.breakpoints[event.line] == undefined)
		{
			this.addBreakpoint(event.path, event.line, "breakpointUnconfirmed");
			this.trigger(new Dagger.Event(this, "addBreakpoint", {path: event.path, line: event.line}));
		}
		else
			this.trigger(new Dagger.Event(this, "removeBreakpoint", {path: event.path, line: event.line}));
	},

	addFile: function FileManager_addFile(subPath, relativeBase, navigateTo)
	{
		if(!subPath)
			return(console.warn("probably not a valid path: ", subPath));

		var fileEntry = {base: relativeBase, dir: Path.dirname(subPath), name: Path.basename(subPath)};
		
		var path = this.resolvePath(fileEntry);

		if(path == undefined)	//unresolvable
		{
			console.warn("Could not resolve path:", subPath, relativeBase);
			return;
		}

		//if the project already contains this file, don't add it.
		for(var i = 0; i < this.project.files.length; i++)
			if(this.resolvePath(this.project.files[i]) == path)
				return;

		this.project.files.push(fileEntry);
		this.saveProject();
		this.updateFilesView();

		if(navigateTo == false)
			return;

		//open the file
		var f = this.insertFile(path);
		this.navigate(path);
	},
	removeFile: function FileManager_removeFile(path)
	{
		if(path == this.currentPath)	//navigate away first
			this.navigate(this.filesByLRU[1]);

		//find the file
		for(var i = 0; i < this.project.files.length; i++)
			if(this.resolvePath(this.project.files[i]) == path)
			{
				this.project.files.splice(i, 1);	//delete the file from the project, not the file itself
				this.updateFilesView();
				this.trigger(new Dagger.Event(this, "removed", {path: path}));
				this.saveProject();
				break;
			}
	},

	resolvePath: function FileManager_resolvePath(projectFileEntity)
	{
		if(projectFileEntity == undefined)
			return(undefined);

		var base = projectFileEntity.base || "project";

		if(this.pathsTable[base] == undefined)
			return(undefined);

		return(		Path.join(	this.pathsTable[base],
								projectFileEntity.dir || "",
								projectFileEntity.name
							)
				);
	},
	updateFilesView: function FileManager_updateFilesView()
	{
		var files = [];
		for(var i = 0; i < this.project.files.length; i++)
		{
			var f = this.project.files[i], path = this.resolvePath(f);
			files.push(
			{
				path: path,
				base: f.base || "project",
				relPath: Path.join(f.dir || "", f.name),
				name: Path.basename(path)
			});
		}

		this.filesView.setData(files);

		return(files);
	},

	showProjectFilesDialog: function FileManager_showProjectFilesDialog()
	{
		var $dialog = $("#projectFilesDialog");

		var tree = new FileTreeView($(".fileTree", $dialog));

		var sourceFiles = /\.(c|cpp|cc|cxx|h|hpp|hh|hxx|s|S)$/;
		
		Q.all(
		[
			lsPromise(this.projectPath, {filter: sourceFiles, hideEmpty: true}),
			lsPromise(this.pathsTable.platform, {filter: sourceFiles, hideEmpty: true}),
			lsPromise(this.pathsTable.sdk, {filter: sourceFiles, hideEmpty: true})
		]).then(function(dirs)
		{
			//setTimeout(function(){	//@@ delayed slightly for demo purposes

			tree.clear();
			
			tree.addBase('<em>This Project</em>', "project|", dirs[0]);
			tree.addBase('<em>Logiblock Platform</em>', "platform|", dirs[1]);
			tree.addBase('<em>GNU SDK</em>', "sdk|", dirs[2]);

			tree.listen("doubleClick", function(e)
			{
				$(".tab-pane.active form", $dialog).trigger("submit");
			}, this);

			//}, 500);	//@@demo

		}.bind(this));

		var listView = new RemoveFileView($(".currentFiles", $dialog));

		listView.listen("selected", function(e)
		{
			listView.setSelected(e.index);	//select it
			removeFileFocus = e.index;
		});
		listView.setData(this.updateFilesView());	//sneaky trick

		var removeFileFocus = "";
		$("input", $dialog).val("");

		//displayed synchronously, though the tree view is displayed asynchronously after dirs have been scanned
		DialogView("Add/Remove Project Files", $dialog, function(success)
		{
			if(!success)	return;	//ignore

			var $tab = $(".tab-pane.active", $dialog);
			if($tab.hasClass("newFile"))	//new or existing?
			{
				var newFileName = String($('input[name="filename"]', $tab).val()).trim();
				if(newFileName.match(/^\/|\.\.\//) || !newFileName.match(sourceFiles))
				{
					$(".alert", $tab).show();
					return(false);	//prevent submission
				}
				else
					$(".alert", $tab).hide();

				this.addFile(newFileName, "project", true);	//new files may only be project-relative
			}
			else if($tab.hasClass("existingFile"))
			{
				var selection = tree.getSelection(),
					s = selection.indexOf("|"),
					base = selection.substr(0, s),
					file = selection.substr(s + 1);
				
				if(!base)
					return(false);

				this.addFile(file, base, true);
			}
			else	//remove
			{
				if(!removeFileFocus)
					return(false);
				this.removeFile(removeFileFocus);
			}

			listView.destroy();
		}, this);
	}
});
function FileManager(pathsTable, editor, filesView)
{
	Dagger.Object.call(this);
	_.extend(this,
	{
		editor: null,
		currentPath: undefined,
		filesByPath: {},
		filesByLRU: [],
		stoppedPoint: null,
		pathsTable: pathsTable,
		projectPath: undefined,
		project: null,
		_needsSave: false
	});
	
	this.setEditor(editor);
	this.setFilesView(filesView);
}



FileTreeView.prototype = _.extend(new Dagger.Object(),
{
	clear: function FileTreeView_clear()
	{
		this.tree.removeChildren(this.tree.getRoot());
	},
	getSelection: function FileTreeView_getSelection()
	{
		return(this.focus);
	},
	addSubtree: function FileTreeView_addSubtree(subtree, idPrefix, parent)
	{
		if(!idPrefix)	idPrefix = "";
		if(!parent)		parent = this.tree.getRoot();

		(function(subtree, idPrefix, parent)
		{
			var keys = Object.keys(subtree);
			for(var i = 0; i < keys.length; i++)
			{
				var name = keys[i], isDir = (typeof subtree[name] != "string");
				var node = new YAHOO.widget.HTMLNode(
				{
					id: idPrefix + name,
					html: (isDir? '<span class="icon-folder-open"></span> ' : '<span class="icon-file"></span> ') + name
				}, parent);

				if(isDir)
					arguments.callee(subtree[name], idPrefix, node);
			}
		})(subtree, idPrefix, parent);

		this.tree.render();
	},
	addBase: function FileTreeView_addBase(title, id, subtree)
	{
		var node = new YAHOO.widget.HTMLNode(
		{
			id: id,
			html: '<span class="icon-book"></span> ' + title
		}, this.tree.getRoot());

		if(subtree)
			this.addSubtree(subtree, id? id : "", node);
		else
			this.tree.render();

		return(node);
	}
});
function FileTreeView(selector)
{
	_.extend(this,
	{
		tree: null,
		$el: null,
		focus: ""
	});

	this.$el = $(selector);
	this.tree = new YAHOO.widget.TreeView(this.$el[0]);

	//show busy indication
	this.tree.removeChildren(this.tree.getRoot());
	new YAHOO.widget.HTMLNode(
	{
		id: undefined,
		html: '<span class="spinning"></span> <em>(Loading...)</em>'
	}, this.tree.getRoot());

	var ths = this;
	this.tree.subscribe("clickEvent", function(e)
	{
		ths.focus = e.node.data.id || "";
		ths.trigger(new Dagger.Event(ths, "click", {focus: ths.focus}));
	});
	this.tree.subscribe("dblClickEvent", function(e)
	{
		ths.focus = e.node.data.id || "";
		ths.trigger(new Dagger.Event(ths, "doubleClick", {focus: ths.focus}));
	});
	this.tree.subscribe("focusChanged", function(e)
	{
		if(e.newNode)
		{
			ths.focus = e.newNode.data.id || "";
			ths.trigger(new Dagger.Event(ths, "select", {focus: ths.focus}));
		}
	});

	this.tree.render();
}



// debugger var view:
VarView.prototype =
{
	trimAndEscape: function VarView_trimAndEscape(text, maxLength)
	{
		if(typeof text != "string")
			text = String(text);
		if(text.length > maxLength)
			text = text.substr(0, maxLength - 3) + "...";

		return($("<a/>").text(text).html());
	},

	formatValue: function VarView_formatValue(value, forceHex)
	{
		if(_.isNumber(value) && forceHex)
			return("0x" + value.toString(16));
		else if(typeof value == "string")
			return("&quot;" + this.trimAndEscape(value, 16) + "&quot;");
		else
			return(this.trimAndEscape(value, 16));
	},

	printVar: function VarView_printVar(variable)
	{
		var v = "<strong>" + variable.name + "</strong> "

		if((variable.value !== undefined) && (variable.type !== undefined))
			v += this.formatValue(variable.value, variable.type && (variable.type.indexOf("*") >= 0));

		return(variable.type? (v + " <em>(" + variable.type + ")</em>") : v);
	},

	genNode: function VarView_genNode(parentNode, variable)
	{
		var childRel = "";
		if(parentNode.data && parentNode.data.id)
			childRel = parentNode.data.id + ".";

		var node = new YAHOO.widget.HTMLNode(
		{
			id: childRel + variable.name,
			html: this.printVar(variable)
		}, parentNode);

		if(variable.children === true)
			node.setDynamicLoad(this.loadVariable.bind(this));
		else if(_.isArray(variable.children))
			for(var i in variable.children)
				arguments.callee.call(this, node, variable.children[i]);
		else if(variable.children)
		{
			//create a synthetic child node for the dereference of the variable as Xcode does
			var derefType = variable.type;

			new YAHOO.widget.HTMLNode(
			{
				id: id,
				html: this.formatValue(variable.children) + (derefType? (" <em>(" + derefType + ")</em>") : "")
			}, node);
		}

		return(node);
	},

	loadVariable: function VarView_loadVariable(node, callback)
	{
		this.deferredEval(node.data.id, function(err, children)
		{
			if(err === undefined)
			{
				for(var i in children)
					this.genNode(node, children[i]);
			}
			callback();
		}.bind(this));
	},


	clear: function VarView_clear()
	{
		this.tree.removeChildren(this.tree.getRoot());
	},

	setData: function VarView_setData(vars)
	{
		this.clear();

		var root = this.tree.getRoot();

		var hasVars = false;
		for(var i in vars)
		{
			this.genNode(root, vars[i]);
			hasVars = true;
		}
		if(!hasVars)
			new YAHOO.widget.HTMLNode(
			{
				html: "<em>(no variables)</em>"
			}, root);

		this.tree.render();
	},
	setDeferredEvaluator: function VarView_setDeferredEvaluator(deferredEvaluator)
	{
		this.deferredEval = deferredEvaluator;
	},
}
function VarView(selector, deferredEvaluator)
{
	Dagger.Object.call(this);
	_.extend(this,
	{
		$el: null,
		$tree: null,
		tree: null,
		deferredEval: deferredEvaluator
	});
	this.$el = $(selector);
	this.$tree = $(".tree", this.$el);
	this.tree = new YAHOO.widget.TreeView(this.$tree[0]);
}


ListView.prototype = _.extend(new Dagger.Object(),
{
	setData: function ListView_setData(data)
	{
		this.clear();

		this.data = data;

		if((data != undefined) && (data.length > 0))
		{
			for(var i = 0; i < data.length; i++)
			{
				var html = this._render(data[i], i, data);
				//instantiate DOM element from html if it isn't one already
				this.$list.append((typeof html == "string")? $(html) : html);
			}
		}

		this.setSelected(this.sel);

		this.$list.children().click(this._onItemSelected.bind(this));
	},
	clear: function ListView_clear()
	{
		this.$list.children().unbind("click");
		this.$list.html("");
	},
	setSelected: function ListView_setSelected(index)
	{
		this.sel = index;
		this.$list.children().removeClass("selected").filter('[data-index="' + index + '"]').addClass("selected");
	},
	destroy: function ListView_destroy()
	{
		this.clear();
		this.$modifyButton.unbind("click");
		this.$el = this.$list = this.$modifyButton = undefined;
	},
	_onItemSelected: function ListView__onItemSelected(event)
	{
		$r = $(event.currentTarget);

		var index = $r.attr("data-index");
		console.log("index " + index + " selected.");
		this.trigger(new Dagger.Event(this, "selected", {index: index}));
	}
});
function ListView(selector, optionalRenderer)
{
	Dagger.Object.call(this);
	_.extend(this,
	{
		$el: null,
		$list: null,
		$modifyButton: null,
		sel: undefined
	});

	this.$el = $(selector);
	this.$list = $("ul.list", this.$el);
	this.$modifyButton = $(".sidebarHeaderButton", this.$el);	//doesn't always have one

	if(optionalRenderer)
		this._render = optionalRenderer;

	this.$modifyButton.click(function(){return(this._onModify());}.bind(this));
}


StackView.prototype = _.extend(new ListView(),
{
	_render: function StackView__render(item, index, data)
	{
		var $line = $("<li/>");
		$line.html((item.func == "??")? ("<em>(unknown)</em> at 0x" + item.addr.toString(16)) : item.func);
		$line.addClass((index & 1)? "odd" : "even");
		$line.attr("data-index", index);
		
		if(item.func == "??")
			$line.attr("title", "0x" + item.addr.toString(16));
		else
			$line.attr("title", item.func + " - " + item.file + ":" + item.line);

		$line.tooltip({html: true, placement: "left", trigger: "hover", container: "#editor", delay: 500});

		return($line);
	}
});
function StackView(selector)
{
	ListView.apply(this, arguments);
}


DeviceView.prototype = _.extend(new ListView(),
{
	_render: function DeviceView__render(item, index, data)
	{
		var $line = $("<li/>");
		$line.html(item.productName + " <em>(" + item.serialNumber + ")</em>");
		$line.addClass((index & 1)? "odd" : "even");
		$line.attr("data-index", item.gdbPort);
		$line.attr("title", item.vendorName + " " + item.productName + " (serial no. \"" + item.serialNumber + "\")");

		$line.tooltip({html: true, placement: "left", trigger: "hover", container: "#editor", delay: 500});

		return($line);
	},
	setData: function DeviceView_setData(data)
	{
		ListView.prototype.setData.apply(this, arguments);

		if((this.data == undefined) || (this.data.length == 0))
		{
			var $line = $("<li><em>(no devices attached)</em></li>");
			$line.addClass("even");
			this.$list.append($line);
		}
	},
});
function DeviceView(selector)
{
	ListView.apply(this, arguments);
}


FilesView.prototype = _.extend(new ListView(),
{
	_render: function FilesView__render(item, index, data)
	{
		var $line = $("<li/>");
		$line.html(item.relPath);	//as opposed to item.name
		$line.addClass((index & 1)? "odd" : "even");
		$line.attr("data-index", item.path);
		$line.attr("title", item.path);

		$line.tooltip({html: true, placement: "left", trigger: "hover", container: "#editor", delay: 500});
		
		return($line);
	},
	_onModify: function FilesView__onModify(event)
	{
		this.trigger(new Dagger.Event(this, "addFile"));	//let another component handle the dialog
	},
	setData: function FilesView_setData(data)
	{
		ListView.prototype.setData.apply(this, arguments);

		if((this.data == undefined) || (this.data.length == 0))
		{
			var $line = $("<li><em>(no project files)</em></li>");
			$line.addClass("even");
			this.$list.append($line);
		}
	},
});
function FilesView(selector, renderFn)
{
	ListView.apply(this, arguments);
}


RemoveFileView.prototype = _.extend(new ListView(),
{
	_render: function RemoveFileView__render(item, index, data)
	{
		var $line = $("<li/>");
		$line.html('<em>&lt;' + item.base + '&gt;</em> ' + item.relPath);
		$line.addClass((index & 1)? "odd" : "even");
		$line.attr("data-index", item.path);

		return($line);
	},
	setData: function RemoveFileView_setData(data)
	{
		ListView.prototype.setData.apply(this, arguments);

		if((this.data == undefined) || (this.data.length == 0))
		{
			var $line = $("<li><em>(no project files)</em></li>");
			$line.addClass("even");
			this.$list.append($line);
		}
	},
});
function RemoveFileView(selector, renderFn)
{
	ListView.apply(this, arguments);
}

RemoveProjectView.prototype = _.extend(new ListView(),
{
	_render: function RemoveProjectView__render(item, index, data)
	{
		var $line = $("<li/>");
		$line.html(item.name || "(untitled)");	//the untitled case should never happen, but just in case
		$line.addClass((index & 1)? "odd" : "even");
		$line.attr("data-index", item.lastPath);

		return($line);
	},
	setData: function RemoveProjectView_setData(data)
	{
		ListView.prototype.setData.apply(this, arguments);

		if((this.data == undefined) || (this.data.length == 0))
		{
			var $line = $("<li><em>(no recent projects)</em></li>");
			$line.addClass("even");
			this.$list.append($line);
		}
	},
});
function RemoveProjectView(selector, renderFn)
{
	ListView.apply(this, arguments);
}





ProblemsView.prototype = _.extend(new ListView(),
{
	_render: function ProblemsView__render(item, index, data)
	{
		var $line = $("<li/>");
		
		var err, type = "Error";
		if(item.err.substr(0, 7) == "error: ")	err = item.err.substr(7);
		else if(item.err.substr(0, 9) == "warning: ")
		{
			type = "Warning";
			err = item.err.substr(9);
		}
		else err = item.err;

		var location = Path.basename(item.file) + ":" + item.line;
		var symbol = (type == "Error")? "icon-remove-sign" : "icon-exclamation-sign";
		
		$line.html('<span class="' + symbol + '"/> ' + err);
		$line.addClass((index & 1)? "odd" : "even");
		$line.attr("data-index", item.file);
		$line.attr("data-line", item.line);

		$line.popover(
		{
			html: true,
			placement: "left",
			trigger: "hover",
			title: '<span class="' + symbol + '"/> Build ' + type,
			content: '<p class="error-body">' + item.err + "</p><hr/><p><em>" + location + "</em></p>",
			delay: 100,
			container: "#editor"
		});

		return($line);
	},
	_onItemSelected: function ProblemsView__onItemSelected(e)
	{
		$item = $(e.currentTarget);
		var path = $item.attr("data-index");
		this.trigger(new Dagger.Event(this, "selected", {index: path, path: path, line: $item.attr("data-line")}));
	},
	setData: function ProblemsView_setData(data)
	{
		ListView.prototype.setData.apply(this, arguments);

		if((this.data == undefined) || (this.data.length == 0))
		{
			var $line = $('<li><span class="icon-ok-sign"/> <em>(no build errors)</em></li>');
			$line.addClass("even");
			this.$list.append($line);
		}
		else if(this.data == true)	//special functionality
		{
			var $line = $('<span class="spinning"/> <em>Building...</em></li>');
			$line.addClass("even");
			this.$list.append($line);
		}
	},
});
function ProblemsView(selector)
{
	ListView.apply(this, arguments);
}





//you may pass a jQ selector or a $(domElement) for 'dialogSelector'
function DialogView(title, dialogSelector, callback, context)
{
	var $el = $("#modalDialog"), $contents = $(dialogSelector);

	//fill it up
	$("h3", $el).html(title);
	$(".modal-body", $el).append($contents);

	var options = {};
	var complete = function DialogView_complete(success)
	{
		var $options = $("input", $el).add("select", $el);
		for(var i = 0; i < $options.length; i++)
			options[$($options[i]).attr("name")] = $($options[i]).val();

		if(callback.call(context, success, options) !== false)
		{
			$ok.unbind("click", submit);
			$cancel.unbind("click", fail);
			$f.unbind("submit", submit);
			$el.modal("hide").on("hidden", function()
			{
				$el.unbind("hidden");
				$("#dialog").append($contents);
			});
		}
	};
	var submit = function DialogView_sumbit(e)
	{
		complete(true, options);
		e.preventDefault();
		return(false);	//html compatibility
	};
	var fail = function DialogView_fail(e)
	{
		complete(false, options);
		e.preventDefault();
		return(false);	//html compatibility
	};

	var $ok = $(".okButton", $el).click(submit);
	var $cancel = $(".cancelButton", $el).click(fail);

	$f = $("form", $el).submit(submit);
	
	$el.bind("shown", function()
	{
		$el.unbind("shown");
		$($("input", $el)[0]).focus();
	});	//show it

	$el.modal("show");
}


//resizable sidebar
(function()
{
	var $sidebar = $(".sidebar");
	var $aceView = $("#aceView");
	var $document = $(document);
	var $editor = $("#editor");
	var baseWidth;
	var basePoint;
	function move(e)
	{
		var w = ((basePoint - e.clientX) + baseWidth).toString();
		
		if(w < 200)	w = 200;
		if(w > 1000) w = 1000;

		$sidebar.css("width", w + "px");
		$aceView.css("right", w + "px");
	}
	function end(e)
	{
		$document.unbind("mousemove", move);
		$document.unbind("mouseup", end);
		$editor.css(
		{
			"-khtml-user-select": "",
			"-webkit-user-select": "",
			"user-select": "",
		});
	}

	$sidebar.mousedown(function(e)
	{
		if((e.offsetX < 0) || (e.offsetX > 4))
			return;

		baseWidth = parseInt($sidebar.css("width"));
		basePoint = e.clientX;

		$document.mousemove(move);
		$document.mouseup(end);
		$editor.css(
		{
			"-khtml-user-select": "none",
			"-webkit-user-select": "none",
			"user-select": "none",
		});
	});
})();

// /sidebar




Button.prototype = _.extend(new Dagger.Object(),
{
	setSymbol: function Button_setSymbol(symbol)
	{
		$("span", this.$el).removeClass(this.symbol).addClass(this.symbol = ("icon-" + symbol));
		return(this);
	},
	setAction: function Button_setAction(action)
	{
		this.action = action;
		if(action === false)	this.$el.addClass("disabled");
		else					this.$el.removeClass("disabled");
		return(this);
	},
	setEnabled: function Button_setEnabled(enabled)
	{
		if(enabled && (this.action !== false))	this.$el.removeClass("disabled");
		else									this.$el.addClass("disabled");
	},

	_onClick: function Button__onClick(event)
	{
		this.$el.popover("hide");
		if(this.action !== false)
			this.trigger(new Dagger.Event(this, "action", {action: this.action, modified: event.shiftKey || event.altKey}));
	}
});
function Button(selector)
{
	Dagger.Object.call(this);
	_.extend(this,
	{
		$el: null,
		action: null,
		symbol: null
	});

	this.$el = $(selector);
	this.symbol = $("span", this.$el).attr("class");
	this.$el.click(this._onClick.bind(this));

	var $docs = $('.documentation[data-for="' + this.$el.attr("id") + '"]');
	if($docs.length > 0)
		this.$el.popover(
		{
			html: true,
			placement: "bottom",
			trigger: "hover",
			title: $(".title", $docs).html(),
			content: $(".body", $docs).html(),
			delay: {show: 1000, hide: 100},
			container: "#editor"
		});
}



DebugTerminal.prototype = _.extend(new Dagger.Object(),
{
	show: function DebugTerminal_show()
	{
		if(this.terminalWindow)
			return;

		this.terminalWindow = window.open("Terminal.html");

		this.window = gui.Window.get(this.terminalWindow);

		this.window.on("loaded", function()
		{
			this.terminalWindow.callback = function(command, term, callback)
			{
				ide.codeTalker.gdbCommand(command, function(error, messages)
				{
					if(error)
						term.echo(error.toString());
					else
						term.echo(messages);

					callback();
				});
			}.bind(this);
		}.bind(this));

		this.window.on("closed", function()
		{
			this.terminalWindow = null;
		}.bind(this));
	}
});
function DebugTerminal(ide)
{
	this.ide = ide;

	this.show();
}



SettingsManager.prototype = _.extend(new Dagger.Object(),
{
	setListView: function SettingsManager_setListView(view)
	{
		(this.views || (this.views = [])).push(view);

		this.listen("change", function()
		{
			view.setData(this.settings.recentProjects);
		}, this);
	},
	load: function SettingsManager_load()
	{
		fs.readFile(Path.join(this.path, "settings.json"), function(error, contents)
		{
			if(error)
				this.settings = {};
			else
				try
				{
					this.settings = JSON.parse(contents);
				}
				catch(err)
				{
					console.warn("Cannot parse settings json! Re-initializing.");
					this.settings = {};
				}

			this.trigger(new Dagger.Event(this, "change"));

		}.bind(this));
	},
	save: function SettingsManager_save()
	{
		mkdirp(this.path, function(err)
		{
			if(err)
				return(console.warn("Can't save project settings, must fly-by-night."));

			fs.writeFile(Path.join(this.path, "settings.json"), JSON.stringify(this.settings), {encoding: "utf8"}, function(error)
			{
				console.log("saving settings " + (error? "failed." : "succeeded."));

				//this.trigger(new Dagger.Event(this, "save", {error: !!error}));
			}.bind(this));

		}.bind(this));
	},

	addProject: function SettingsManager_addProject(name, description)
	{
		//try to create it
		var projectBase = Path.join(Config.projectsDir(), name);
		mkdirp(projectBase, function(err)
		{
			if(err)
				return(console.warn("Error: could not create project: ", err));

			//create the project
			fs.writeFile(Path.join(projectBase, "module.json"), JSON.stringify(
			{
				name: name,
				files: [{name: "main.cpp"}],
				description: description || "",
				version: "0.1",
				compatibleWith: ["Galago4"],
				dependencies: []
			}),
			function(err)
			{
				if(err)
					return(console.warn("Error: could not create project: ", err));

				fs.writeFile(Path.join(projectBase, "main.cpp"), "#include <GalagoAPI.h>\nusing namespace Galago;\n\nint main(void)\n{\n\twhile(true)\n\t\tsystem.sleep();\n}\n", function(err)
				{
					if(err)
						return(console.warn("Error: could not create project: ", err));

					this.addExistingProject(projectBase, name);

				}.bind(this));

			}.bind(this));

		}.bind(this));
	},
	addExistingProject: function SettingsManager_addExistingProject(path)
	{
		fs.readFile(Path.join(path, "module.json"), function(err, contents)
		{
			if(err)
				return(console.warn("Could not add project because its module.json file could not be opened."));
			
			var moduleJSON;
			try{ moduleJSON = JSON.parse(contents); }
			catch(e)
			{
				return(console.warn("Could not add project because its module.json file could not be parsed."));
			}

			//create and add the project to the IDE settings
			(this.settings.recentProjects || (this.settings.recentProjects = [])).push(
			{
				name: moduleJSON.name,
				lastPath: path,
				modifiedTime: Date.now()
			});
			this.trigger(new Dagger.Event(this, "change"));

		}.bind(this));
	},
	touchProject: function SettingsManager_touchProject(path)
	{
		if(this.settings.recentProjects)
			for(var i = 0; i < this.settings.recentProjects.length; i++)
				if(this.settings.recentProjects[i].lastPath == path)
				{
					this.settings.recentProjects[i].modifiedTime = Date.now();
					this.trigger(new Dagger.Event(this, "change"));
					break;
				}
	},
	removeProject: function SettingsManager_removeProject(path)
	{
		if(this.settings.recentProjects)
			for(var i = 0; i < this.settings.recentProjects.length; i++)
				if(this.settings.recentProjects[i].lastPath == path)
				{
					this.settings.recentProjects.splice(i, 1);
					this.trigger(new Dagger.Event(this, "change"));
					break;
				}
	},

	showCreateProjectDialog: function IDE_showCreateProjectDialog()
	{
		var $dialog = $("#createProjectDialog");
		$("input", $dialog).val("");
		
		var tree = new FileTreeView($(".fileTree", $dialog));

		var base = Config.projectsDir();
		ls(base, {filter: /^$/}, function(subtree)
		{
			tree.clear();
			tree.addBase('<em>Local Projects</em>', base + Path.sep, subtree);
		});
		
		tree.listen("doubleClick", function()
		{
			$(".tab-pane.active form", $dialog).trigger("submit");
		});

		
		var removeFileFocus = "";
		var listView = new RemoveProjectView($(".currentFiles", $dialog));

		listView.listen("selected", function(e)
		{
			listView.setSelected(e.index);	//select it
			removeFileFocus = e.index;
		});
		listView.setData(this.settings.recentProjects || {});


		DialogView("Add / Remove Project", $dialog, function(success, data)
		{
			if(!success) return;	//ignore

			var $tab = $(".tab-pane.active", $dialog);
			if($tab.hasClass("newProject"))
			{
				var name = String(data.name).trim();
				if(!name || name.match(/[^A-Za-z0-9_-]/))
				{
					$(".alert", $dialog).show();
					return(false);
				}
				$(".alert", $dialog).hide();
				this.addProject(name, String(data.desc).trim());
			}
			else if($tab.hasClass("existingProject"))
			{
				console.log("would add: ", tree.getSelection());

				if(!tree.getSelection())
					return(false);

				this.addExistingProject(tree.getSelection());
			}
			else
			{
				if(!removeFileFocus)
					return(false);

				this.removeProject(removeFileFocus);
			}
		}, this);
	},

});
function SettingsManager(pathsTable)
{
	_.extend(this,
	{
		pathsTable: pathsTable,
		path: Config.settingsDir(),
		settings: {}
	});

	this.listen("change", function()	//pub/sub to the max
	{
		this.save();
	}, this);
}





RecentProjectsView.prototype = _.extend(new ListView(),
{
	_render: function RecentProjectsView__render(item, index, data)
	{
		var $thumb = $("<li/>");
		
		var date = "";
		var age = (Date.now() - item.modifiedTime) / 1000;
		if(age < 60)
			date = "just now";
		else if(age < 3600)
			date = this._formatUnit(parseInt((age + 59) / 60), "minute", "minutes") + " ago";
		else if(age < 86400)
			date = this._formatUnit(parseInt((age + 3599) / 3600), "hour", "hours") + " ago";
		else if(age < 172800)
			date = "yesterday";
		else if(age < 604800)
			date = this._formatUnit(parseInt((age + 86399) / 86400), "day", "days") + " ago";
		else if(age < 4838400)
			date = this._formatUnit(parseInt((age + 604799) / 604800), "week", "weeks") + " ago";
		else
		{
			var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
			var d = Date(item.modifiedTime);
			date = months[d.getMonths()] + " " + (d.getYear() + 1900).toString();
		}

		$thumb.html('<li class="thumbnail projectThumb"><h3>' + item.name + '</h3><small>' + date + '</small></li>');
		$thumb.attr("data-index", item.lastPath);
		
		return($thumb);
	},

	//English-language singlar/plural rule
	_formatUnit: function RecentProjectsView__formatUnit(qty, singular, plural)
	{
		return(qty.toString() + " " + ((qty == 1)? singular : plural));
	},

	setData: function RecentProjectsView_setData(data)
	{
		ListView.prototype.setData.apply(this, arguments);

		if((this.data == undefined) || (this.data.length == 0))
		{
			var $item = $('<li class="thumbnail projectThumb"><h3><em>No projects!</em></h3><small>Click the New button above to create one.</small></li>');
			this.$list.append($item);
		}
	}	
});
function RecentProjectsView(selector)
{
	ListView.apply(this, arguments);
}




IDE.prototype = _.extend(new Dagger.Object(),
{
	init: function IDE_init(codeTalker)
	{
		this.codeTalker = codeTalker;

		this.editor = new EditorView("#aceView");

		this.filesView = new FilesView("#files");
		
		this.settingsManager = new SettingsManager(this.codeTalker.getPaths());

		this.fileManager = new FileManager(this.codeTalker.getPaths(), this.editor, this.filesView);

		this.tabs = new TabView("#tabs", this.fileManager);

		this.deviceView = new DeviceView("#devices");
		this.stackView = new StackView("#stack");
		this.varView = new VarView("#varTree");

		this.problemsView = new ProblemsView("#problems");
		this.problemsView.setData();

		this.recentProjectsView = new RecentProjectsView("#recentProjects");

		this.verifyRestartButton = new Button("#verifyRestart");
		this.runContinueButton = new Button("#runContinue");
		this.debugPauseButton = new Button("#debugPause");
		this.stopButton = new Button("#stop");

		this.deviceView.setData();

		this.settingsManager.setListView(this.recentProjectsView);
		this.recentProjectsView.listen("selected", function(e)
		{
			this.openProject(e.index);
		}, this);

		this.settingsManager.load();

		this.fileManager.listen("projectUpdate", function(e)
		{
			this.settingsManager.touchProject(e.path);	//update last-modified time
		}, this);

		this.tabs.listen("selected", function(e)
		{
			this.fileManager.navigate(e.path);
		}, this);

		this.problemsView.listen("selected", function(e)
		{
			this.fileManager.navigate(e.path, e.line);
		}, this);

		this.deviceView.listen("selected", this.onDeviceSelect, this);
		
		this.stackView.listen("selected", this.onFrameChange, this);

		this.codeTalker.listen("runstate", this.onRunStateChange.bind(this));

		/*
		this.codeTalker.listen("breakpointsChanged", function(breakpoints)
		{
			//NYI
		}.bind(this));
		*/

		this.codeTalker.listen("deviceStatus", this.onDeviceChange.bind(this));
		this.codeTalker.listen("devicePlug", this.onDeviceChange.bind(this));
		
		this.varView.setDeferredEvaluator(this.codeTalker.dereferenceVar.bind(this.codeTalker));

		this.fileManager.listen("addBreakpoint", function(event)
		{
			//try to find a matching entry in breakpointTable
			for(var i in this.breakpointTable)
				if((this.breakpointTable[i].path == event.path) && (this.breakpointTable[i].line == event.line))
					return;

			this.codeTalker.setBreakpoint(event.path, event.line, function(error, breakpointNum)
			{
				if(error)
					return(this.fileManager.removeBreakpoint(event.path, event.line));
				
				this.breakpointTable.push({path: event.path, line: event.line, num: breakpointNum});
				
				//setTimeout(function() {	//@@delayed by 500ms for demonstration purposes
				
					this.fileManager.addBreakpoint(event.path, event.line, "breakpoint");
				
				//}.bind(this), 500);	//@@demo

			}.bind(this));
		}.bind(this));

		this.fileManager.listen("removeBreakpoint", function(event)
		{
			//try to find a matching entry in breakpointTable
			var breakpointIdx;
			for(var i in this.breakpointTable)
				if((this.breakpointTable[i].path == event.path) && (this.breakpointTable[i].line == event.line))
				{
					breakpointIdx = i;
					break;
				}
			if(breakpointIdx == undefined)
				return;

			this.codeTalker.removeBreakpoint(this.breakpointTable[breakpointIdx].num, function(error)
			{
				if(error)
					return(console.warn("Unable to remove breakpoint."));	//um?

				this.breakpointTable.splice(breakpointIdx, 1);
				this.fileManager.removeBreakpoint(event.path, event.line);
			}.bind(this));
		}.bind(this));

		this.verifyRestartButton.listen("action", this.onButtonStateChange, this);
		this.runContinueButton.listen("action", this.onButtonStateChange, this);
		this.debugPauseButton.listen("action", this.onButtonStateChange, this);
		this.stopButton.listen("action", this.onButtonStateChange, this);


		$("#createProject").click(function(e)
		{
			this.settingsManager.showCreateProjectDialog();

			e.preventDefault(); return(false);
		}.bind(this));

		$("#settingsButton").click(function(e)
		{
			this.showSettings();

			e.preventDefault();
		}.bind(this));

		$("#gdbConsole").click(function(e)
		{
			if(this.gdbConsole == undefined)
				this.gdbConsole = new DebugTerminal(this);
			else
				this.gdbConsole.show();

			e.preventDefault();
		}.bind(this));

		$("#homeButton").click(function(e)
		{
			this.goHome();
			e.preventDefault();
		}.bind(this));


		//finally, enter the home screen
		this.goHome();
	},

	onDeviceSelect: function IDE_onDeviceSelect(event)
	{
		this.deviceView.setSelected(event.index);
		this.devicePort = event.index;
	},
	onDeviceChange: function IDE_onDeviceChange(event)
	{
		switch(event.event)
		{
		case "plug":
			if(this.devicePort == undefined)
				this.devicePort = event.device.gdbPort;
			break;
		case "status":
			console.log("devices: ", event.devices);
			this.deviceView.setData(event.devices);
			this.deviceView.setSelected(this.devicePort);

			var safe = false;
			for(var i = 0; i < event.devices.length; i++)
				if(event.devices[i].gdbPort == this.devicePort)
				{
					safe = true;
					break;
				}

			if(!safe)
			{
				this.devicePort = undefined;

				//must resign debug session if the active device was removed
				switch(this.runState)
				{
				case "running":
				case "stopped":
					console.warn("Unplugged the device we were debugging with!");
					this.setRunState("editing");
					break;
				}
			}
			break;
		}
	},


	//respond to GDB-initiated state changes
	onRunStateChange: function IDE_onRunStateChange(status)
	{
		//in certains states, intentionally ignore GDB state changes
		switch(this.runState)
		{
		case "flashing":
			return;
		}

		switch(status.state)
		{
		case "stopped":
			console.log(">>> UI set for stopped mode <<<: ", status);
			
			this.codeTalker.updateCallstack(function(err)
			{
				if(err)
					return;

				//update the callstack
				var callstack = this.codeTalker.getStack();
				this.stackView.setData(callstack);
				
				//create annotations for the whole callstack
				for(var i = 0; i < callstack.length; i++)
					this.fileManager.addStackpoint(		callstack[i].path,
														callstack[i].line,
														(callstack[i].level == 0)? "stopped" : "caller"
													);

				//jump to the stopped line
				if(status.reason.frame != undefined)
					this.fileManager.navigate(status.reason.frame.fullname, status.reason.frame.line);
				else if((callstack.length > 0) && (callstack[0].path))
					this.fileManager.navigate(callstack[0].path, callstack[0].line);
				else
					console.warn("We're stopped, but I don't know where!");

				//update variables for that frame (also highlights the right frame in the stack view)
				this.updateVarsForFrame();
			}.bind(this));

			this.setRunState(status.state);
			break;
		case "running":
			console.log(">>> UI set for run mode <<<");

			//remove all annotations for the last callstack
			this.stackView.setData();
			this.fileManager.removeStackpoint();

			this.setRunState(status.state);
			break;
		}
	},

	updateVarsForFrame: function IDE_updateVarsForFrame()
	{
		//a new frame has already been set if necessary, so simply refresh data
		this.stackView.setSelected(this.codeTalker.getVarFrame());

		this.codeTalker.updateVars(function(err)
		{
			this.varView.setData(this.codeTalker.getVars());		//update UI
		}.bind(this));
	},

	setRunState: function IDE_setRunState(newRunState)
	{
		//passively (idempotently) respond to the state change and retain it

		if(this.runState == newRunState)
			return;

		switch(newRunState)
		{
		case "running":
		case "stopped":
		case "flashing":
			$("#sidebarSections").children().hide().filter(".visibleDebug").show();
			this.editor.setReadOnly(true);
			
			break;

		case "editing":
			$("#sidebarSections").children().hide().filter(".visibleEdit").show();
			this.stackView.setData();
			this.fileManager.removeStackpoint();
			this.editor.setReadOnly(false);

			break;
		}
		switch(newRunState)
		{
		case "editing":
			this.verifyRestartButton.setSymbol("ok").setAction("building");
			this.runContinueButton.setSymbol("play").setAction(this.firmwareImage? "running" : false);
			this.debugPauseButton.setSymbol("pause").setAction(this.firmwareImage? "stopped" : false);
			this.stopButton.setSymbol("eject").setAction(false);
			break;

		case "building":
			this.verifyRestartButton.setSymbol("ok").setAction(false);
			this.runContinueButton.setSymbol("play").setAction(false);
			this.debugPauseButton.setSymbol("pause").setAction(false);
			this.stopButton.setSymbol("eject").setAction(false);	//@@support cancelling a build?
			break;

		case "flashing":
			this.verifyRestartButton.setSymbol("ok").setAction(false);
			this.runContinueButton.setSymbol("play").setAction(false);
			this.debugPauseButton.setSymbol("pause").setAction(false);
			this.stopButton.setSymbol("eject").setAction("editing");
			break;

		case "running":
			this.verifyRestartButton.setSymbol("repeat").setAction(false);
			this.runContinueButton.setSymbol("play").setAction(false);
			this.debugPauseButton.setSymbol("pause").setAction("stopped");
			this.stopButton.setSymbol("eject").setAction(false);	//@@need to enable this but gdb limits us
			break;

		case "stopped":
			this.verifyRestartButton.setSymbol("repeat").setAction("restart");
			this.runContinueButton.setSymbol("play").setAction("running");
			this.debugPauseButton.setSymbol("pause").setAction(false);
			this.stopButton.setSymbol("eject").setAction("editing");
			break;
		}
		this.runState = newRunState;
	},

	onButtonStateChange: function IDE_onButtonStateChange(event)
	{
		//actively respond to user-initiated state changes

		switch(event.action)
		{
		case "editing":
			//if we're running or stopped, exit debugging mode
			switch(this.runState)
			{
			case "running":
			case "stopped":
			case "flashing":
				this.setAllButtonsEnabled(false);
				
				this.codeTalker.disconnect(function(error)
				{
					//codetalker shouldn't report any further state changes
					this.setRunState("editing");
				}.bind(this));
				break;
			}
			break;
		case "building":
			//only if we're in editing mode, build the project
			if(this.runState == "editing")
			{
				this.setRunState("building");
				
				if(this.fileManager.needsSave())
					this.fileManager.saveProject(true);
				
				this.problemsView.setData(true);	//special functionality to show build progress
				
				this.firmwareImage = undefined;
				this.codeTalker.build(this.fileManager.getProjectPath(), function(err, elf, result)
				{
					console.log("Build complete, results: ", arguments);

					if(!err)
					{
						this.problemsView.setData(result.compileErrors);

						if(!result.compileErrors || (result.compileErrors.length == 0))
							this.codeTalker.setELF(elf, function(error)
							{
								console.log("Set firmware to: ", elf, (error? "unsuccessfully" : "successfully"));
								if(!error)
									this.firmwareImage = elf;

								this.setRunState("editing");

							}.bind(this));
						else
							this.setRunState("editing");
					}
					else
					{
						console.warn("Totally failed to build.");
						this.setRunState("editing");
					}

				}.bind(this), 1000);
			}
			break;
		case "restart":
			//only if we're stopped, restart execution
			if(this.runState == "stopped")
			{
				this.setAllButtonsEnabled(false);

				this.codeTalker.restart(function(error)
				{
					if(error)
					{
						this.setAllButtonsEnabled(true);
						console.warn("Error: ", error, error.stack);
					}
				}.bind(this));
			}
			break;
		case "running":
			//if we're stopped, continue
			//if we're editing, connect gdb, flash and continue
			if(this.runState == "stopped")
			{
				this.setAllButtonsEnabled(false);
				
				this.codeTalker.run(function(error)
				{
					if(error)
					{
						this.setAllButtonsEnabled(true);
						console.warn("Error: ", error);
					}
					//else codetalker signals the correct state transition
				}.bind(this));
			}
			else if(this.runState == "editing")
			{
				this.setAllButtonsEnabled(false);
				
				//ugly hack just to ensure we connect with a proper device //@@necessary???
				if(this.devicePort == undefined)
					this.devicePort = this.deviceView.data[0].gdbPort;

				if(this.devicePort == undefined)
					break;

				this.setRunState("flashing");
				this.codeTalker.connect(this.devicePort, function(error)
				{
					if(error)
					{
						this.setAllButtonsEnabled(true);
						console.warn("Error: ", error);
						return;
					}
					
					//@@only flash if the firmware is newer than the last image we installed

					this.codeTalker.flash(function(err)
					{
						if(!err)
						{
							//if a modifier key is held down when the button is clicked,
							//  stop on the first instruction (i.e. don't run)
							this.setRunState("stopped");
							if(!event.modified)
							{
								this.codeTalker.run(function(error)
								{
									if(error)
									{
										this.setRunState("stopped");
										console.warn("Failed to continue! Error: ", error);
									}
									//else codetalker signals the correct run-time state transition
								}.bind(this));
							}
						}
						else
						{
							this.setRunState("editing");
							console.warn("Failed to flash! Error: ", error);
						}
					}.bind(this));

				}.bind(this));
			}
			break;
		case "stopped":
			//if we're running, pause
			//if we're editing, connect gdb, flash and stop at the beginning (default gdb behaviour)
			if(this.runState == "running")
			{
				this.setAllButtonsEnabled(false);
				
				this.codeTalker.pause(function(error)
				{
					if(error)
					{
						this.setAllButtonsEnabled(true);
						console.warn("Error: ", error);
					}
					//else codetalker signals the correct state transition
				}.bind(this));
			}
			else if(this.runState == "editing")
			{
				this.setAllButtonsEnabled(false);
				
				this.codeTalker.connect(this.devicePort, function(error)
				{
					if(error)	//if connecting to the hardware failed or timed out
					{
						this.setAllButtonsEnabled(true);
						console.warn("Error: ", error);
					}
					//else codetalker signals the correct state transition
				}.bind(this));
			}
			break;
		}
	},
	onFrameChange: function IDE_onFrameChange(event)
	{
		if(this.runState != "stopped")
			return;

		var frame = event.index;
		this.codeTalker.setVarFrame(frame, function(error)
		{
			if(error != undefined)
				return;

			this.updateVarsForFrame();
			var callstack = this.codeTalker.getStack();
			
			if(callstack[frame].path)
				this.fileManager.navigate(callstack[frame].path, callstack[frame].line);
			else
				console.warn("can't resolve that frame");

		}.bind(this));
	},

	setAllButtonsEnabled: function IDE_setAllButtonsEnabled(enabled)
	{
		this.verifyRestartButton.setEnabled(enabled);
		this.runContinueButton.setEnabled(enabled);
		this.debugPauseButton.setEnabled(enabled);
		this.stopButton.setEnabled(enabled);
	},



	goHome: function IDE_goHome()
	{
		$("#editor").hide();
		this.fileManager.closeProject();
		this.tabs.setData();	//@@hackish

		$("#home").show();
	},

	openProject: function IDE_openProject(projectPath)
	{
		$("#home").hide();

		this.setRunState("editing");
		this.fileManager.openProject(projectPath);
		
		$("#editor").show();
	},

	showSettings: function IDE_showSettings()
	{
		var $el = $("#settingsDialog");
		$("input", $el).val();
		DialogView("Settings", $el, function(success, data)
		{
			console.log(success, data);
		}, this);
	},
	
	showUpdateSettings: function IDE_showSettings()
	{
		DialogView("Settings", $("#settingsDialog"), function(success, data)
		{
			console.log(success, data);
		}, this);
	}

});
function IDE()
{
	_.extend(this,
	{
		runState: null,
		breakpointTable: [],

		codeTalker: null,
		
		fileManager: null,
		editor: null,
		stackView: null,
		varView: null,
		tabs: null,

		verifyRestartButton: null,
		runContinueButton: null,
		debugPauseButton: null,
		stopButton: null
	});
}

$(function()
{
	window.ide = new IDE();

	new CodeTalker.CodeTalker().promise.then(function(codeTalker)
	{
		window.ide.init(codeTalker);
		setWindowTitle();
	}).fail(function()
	{
		console.warn("startup failed, fall back to launchupdate layer.");
	});
});
