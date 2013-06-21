/*

Models = Dagger.DefineRelatedModels(
{
	User: Dagger.DefineModel(
		{
			id: String,
			username: String
		},
		{
			toString: function()
			{
				return("A huge dork");	//debug
			},
			init: function(data)
			{
				console.log("User init with: ", data);
				_.extend(this, data);
			},
			load: function()
			{
			}
		}),
		
	File: Dagger.DefineModel(
		{
			path: String,
			contents: String,
			open: Number,
			modified: Date
		},
		{
		}),

	Navigation: Dagger.DefineModel(
		{
			projects: [
				{
					title: String,
					href: String
				}
			]
		},
		{
		}),
	
	News: Dagger.DefineModel(
		{
			posted: Date,
			author: "User",
			title: String,
			body: String
		},
		{
		}),
		
	Project: Dagger.DefineModel(
		{
			name: String,
			path: String,
			files: ["File"],
			openFiles: ["File"],
			modified: Date
		},
		{
		}),

	Home: Dagger.DefineModel(
		{
			recentNews: ["News"],
			projects: ["Project"],
			projectSearch: String,
			currentProject: "Project"
		},
		{
		})
});

function Render()
{
	this.render();
}

Views =
{
	ProjectTabs: Dagger.DefineView(
		{
			template: "topNavigation",
			dataEvents:
			{
				changed: Render
			},
			show: function(file)
			{
				console.log("Might shuffle tabs to make sure ", file, " is showing.");
			}
		}),

	ProjectSettingsMenu: Dagger.DefineView(
		{
			template: "dropdownMenuItems",
			dataEvents:
			{
				changed: Render
			},
		}),

	Project: Dagger.DefineView(
		{
			template: "#editor",
			dataEvents:
			{
				changed: Render
			},
			init: function()
			{
				this._super.init.apply(this, arguments);
				
				this.tabs = new Views.ProjectTabs(this.data && this.data.openFiles);
				this.allFiles = new Views.ProjectSettingsMenu(this.data && this.data.openFiles);

				window.$("#homeButton").click(this.closeProject.bind(this));

				//open the main file @@replace with stored session data

				this.openFile("main.cpp");
			},
			setData: function(data)
			{
				console.log("setData: ", data);
				this._super.setData.apply(this, arguments);
				if(this.data)
				{
					this.tabs.setData(this.data.openFiles);
					this.allFiles.setData(this.data.openFiles);
				}
			},
			openFileByPath: function(path)
			{
				for(var f in this.data.openFiles)
					if(f.path == path)
						return(this.tabs.show(f));	//ensure the already-open file is visible in the tabset

				var f = new Models.File(path);
				this.data.openFiles.push(f);	//put the file in the open list
				this.tabs.show(f);				//and ensure it's visible in the tabset
			},
			closeProject: function()
			{
				console.log("closing project, navigating back to home");
			},
		}),

	Blog: Dagger.DefineView(
		{
			template: "blog",
			dataEvents:
			{
				changed: Render
			}
		}),
	ProjectThumb: Dagger.DefineView(
		{
			template: "homeThumbnail",
			dataEvents:
			{
				changed: Render
			}
		}),

	Home: Dagger.DefineView(
		{
			template: "#home",
			
			blogView: null,
			projectThumbView: null,

			dataEvents:
			{
				changed: Render
			},

			init: function(data)
			{
				this._super.init.apply(this, arguments);
				
				this.blogView = new Views.Blog(this.data.recentNews);
				this.projectThumbView = new Views.ProjectThumb(this.data.projects);

				window.$("#projectSearch").change(this.onProjectSearchChange.bind(this))
					.keydown(this.onProjectSearchChange.bind(this));
			},
			deinit: function(data)
			{
				window.$("#projectSearch").unbind("change");

				this.blogView.deinit();
				this.projectThumbView.deinit();

				this._super.deinit.apply(this, arguments);
			},
			render: function()
			{
				console.log("rendering home with data: ", this.data);
			},
			onProjectSearchChange: _.debounce(function(e)
			{
				console.log(e);
			}, 300),
		}),
};

Dagger.DefineHelpers();

//this view instance exists outside any section of the site
//var navView = new Views.Navigation(new Models.Navigation());

var homeView = new Views.Home(new Models.Home(
{
	recentNews:
	[
		{
			posted: new Date(),
			author: {id: "1"},
			title: "announcement",
			body: "some news, yall"
		}
	],
	projects:
	[
		{
			name: "test",
			path: "/path/to/project",
			files: [
			{
				path: "main.cpp",
				contents: "main(void){}",
				open: 1,
				modified: new Date()
			}],
			openFiles: [
			{
				path: "main.cpp"
			}],
			modified: new Date()
		}
	]
}));
*/

//navView.data.set({projects:[{title:"main.cpp", href:"#/test/main.cpp"}, {title:"GalagoAPI.cpp", href:"#/logiblock+platform/galago/GalagoAPI.cpp"}]});

//homeView.data.recentNews.push(new Models.News({title:"announcement", author:{id: "1"}, body:"hello world!"}));
//homeView.data.projects.push(new Models.Project({name:"hello", date:"yesterday"}));

var aceRange = ace.require("ace/range").Range;
var aceCppMode = ace.require("ace/mode/c_cpp").Mode;
var AceEditSession = ace.require("ace/edit_session").EditSession;
var AceDocument = ace.require("ace/document").Document;
var AceRange = ace.require("ace/range").Range;

//node requirements
var fs = require("fs");
var CodeTalker = require("./codetalker");

File.prototype = _.extend(new Dagger.Object(),
{
	path: null,
	contents: null,
	session: null,
	document: null,
	needsSave: false,

	close: function File_close()
	{
		if(this.needsSave)
			this.save(true);
		if(this.document != undefined)
			this.document.removeEventListener("changed", this._onChangeListener);
	},

	_onFileRead: function File__onFileRead(error, contents)
	{
		console.log("read file yo!")
		this.contents = contents;
		this.trigger(new Dagger.Event(this, "load"));
	},
	bind: function File_bind(aceSession)
	{
		this.session = aceSession;

		this.session.setValue(this.contents, {renderCall: true})

		this.document = this.session.getDocument();

		this.document.on("changed", this._onChangeListener = function(e)
		{
			if(!this.needsSave)
				this.trigger(new Dagger.Event(this, "needsSave"));
			this.needsSave = true;
			
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
		if(this.needsSave)
			this.trigger(new Dagger.Event(this, "save"));

		this.needsSave = false;

		console.log("will save '" + this.path + "' now.");
		fs.writeFile(this.path, this.contents, {encoding: "utf8"})
	}
});
function File(path)
{
	Dagger.Object.call(this);

	if(path)
		fs.readFile(path, {encoding: "utf8"}, this._onFileRead.bind(this));

	this.path = path;
}

EditorView.prototype = _.extend(new Dagger.Object(),
{
	file: null,
	editor: null,
	breakpoints: null,
	selector: null,

	init: function EditorView_init(selector)
	{
		if(selector != undefined)
			this.selector = selector;

		if(this.selector == undefined)
			throw new Error("No selector specified, cannot initialize ACE.");

		this.editor = ace.edit($(this.selector)[0]);

		//this.el.style.fontSize = "11px";

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

		this.file.listen("load", function()
		{
			this.file.bind(this.editor.getSession());

			this.trigger(new Dagger.Event(this, "opened"));
		}.bind(this));
	},

	close: function EditorView_close()
	{
		if(this.file != null)
		{
			this.file.close();
			this.file = null;
		}
	},
	
	setReadOnly: function EditorView_setReadOnly(readOnly)
	{
		this.editor.setReadOnly(readOnly);
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
		
		var gutter = false;
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

		// rows are zero-indexed, lines are not
		var line = row + 1;
		
		/*
		if(this.breakpoints[line])
			this.removeBreakpoint(this.file.path, line);
		else
		{
			this.editor.session.setBreakpoint(row, "ace_breakpoint_unconfirmed");
			this.breakpoints[line] = true;
		*/
		
		this.trigger(new Dagger.Event(this, "toggleBreakpoint", {path: this.file.path, line: line}));

		event.stop();
	},
});
function EditorView(selector)
{
	Dagger.Object.call(this);
	this.markers = {};

	this.onToggleBreakpoint = this.onToggleBreakpoint.bind(this);
	
	if((this.selector = selector) != undefined)
		this.init();
}




TabView.prototype = _.extend(new Dagger.Object(),
{
	_onFileSelected: function TabView__onFilesChanged(event)
	{
		//find the child of $el that event.path refers to.
		//  if it doesn't exist, make one and insert it at the beginning
		//  else:
		//    if it's not entirely in the clipping rectangle of the container, move it to the beginning
		//    else select it

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
			$f.insertAfter(this.$el.children(".tabstart"));
			this.$currentSelection = $f;
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

		//@@ trim children to some number higher than the max visible, like 25

	},

	_onTabClicked: function TabView__onTabClicked(event)
	{
		var $tab = $(event.target);

		var path = $tab.attr("href");
		if(path)
			this.trigger(new Dagger.Event(this, "selected", {path: path.substr(1)}));

		return(false);	//no browser navigation
	},

	$el: null,
	$currentSelection: null
});
function TabView(selector, fileManager)
{
	Dagger.Object.call(this);

	this.$el = $(selector);
	this.$el.click(this._onTabClicked.bind(this));

	this.fileManager = fileManager;

	this.fileManager.listen("navigated", this._onFileSelected, this);
}



// FileManager

FileManager.prototype = _.extend(new Dagger.Object(),
{
	setEditor: function FileManager_setEditor(editor)
	{
		this.editor = editor;

		this.editor.listen("toggleBreakpoint", this.onBreakpointRequested, this);
	},

	//line is optional
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

			f = this.filesByPath[this.currentPath = path];
			if(f == undefined)	//the file isn't open yet
			{
				f = this.insertFile(this.currentPath);

				this.filesByLRU.unshift(f);
			}
			else
			{
				//update the access time and bump it to the head
				f.lastAccessed = Date.now();
				var off = this.filesByLRU.indexOf(f);
				this.filesByLRU.splice(off, 1);
				this.filesByLRU.unshift(f);
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
		else
		{
			f = this.filesByPath[this.currentPath];

			if(line != undefined)
				this.editor.jumpToLine(line);
			
			this.restoreAnnotations();
		}

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

	editor: null,
	currentPath: null,
	filesByPath: null,
	filesByLRU: null,
	stoppedPoint: null,
});
function FileManager(editor)
{
	Dagger.Object.call(this);
	this.currentPath = undefined;
	this.filesByPath = {};
	this.filesByLRU = [];
	this.setEditor(editor);
}

//



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
				id: id,		//@@possible problem
				html: this.formatValue(variable.children) + (derefType? (" <em>(" + derefType + ")</em>") : "")
			}, node);
		}

		return(node);
	},

	loadVariable: function VarView_loadVariable(node, callback)
	{
		console.log("would load: ", node);

		/*
		setTimeout(function()
		{
			var fakeVars =
			[
				{name: "string1", type: "char const*", value: 0x10001234, children: "herp derp"},
				{name: "string2", type: "char const*", value: 0, children: true},
				{name: "num", type: "int", value: 1048576},
				{name: "numptr", type: "int*", value: 0x10001234, children: 1048576},
			];

			for(var i in fakeVars)
				this.genNode(node, fakeVars[i]);

			callback();
		}.bind(this), 500);
		*/

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

		for(var i in vars)
			this.genNode(root, vars[i]);

		this.tree.render();
	},
	setDeferredEvaluator: function VarView_setDeferredEvaluator(deferredEvaluator)
	{
		this.deferredEval = deferredEvaluator;
	},
}
function VarView(selector, deferredEvaluator)
{
	this.tree = new YAHOO.widget.TreeView($(selector)[0]);
	this.deferredEval = deferredEvaluator;
}


//test data
/*var vars =
[
	{name: "num", type: "int", value: 1048576},
	{name: "numptr", type: "int*", value: 0x10001234, children: 1048576},
	{name: "job", type: "Galago::Task", children: [{name: "_t", type: "InternalTask*", value: 0x10001234, children: true}]},
	{name: "buf", type: "Galago::Buffer", children: [{name: "_b", type: "InternalBuffer*", value: 0x10001234, children: true}]},
	{name: "p4", type: "Galago::IO::Pin", children: [{name: "_b", type: "InternalBuffer*", value: 0x10001234, children: true}]},
	{name: "string1", type: "char const*", value: 0x10001234, children: "herp derp"},
	{name: "string2", type: "char const*", value: 0, children: true},
	{name: "nullptr", type: "ComplexStruct const*", value: 0},
	{name: "validptr", type: "ComplexStruct const*", value: 0x10001234, children: [{name: "a", type: "int", value: 5}]},
	{name: "deferredptr", type: "ComplexStruct const*", value: 0x10001234, children: true},
];*/

//varView.setData(vars);








StackView.prototype = _.extend(new Dagger.Object(),
{
	$el: null,

	setData: function StackView_setData(data)
	{
		this.clear();

		this.data = data;

		if(data != undefined)
			for(var i = 0; i < data.length; i++)
			{
				$line = $("<li/>");
				$line.html(data[i].func);
				$line.addClass((i & 1)? "odd" : "even");
				$line.attr("data-frame", i);
				this.$el.append($line);
			}
	},
	clear: function StackView_clear()
	{
		this.$el.html("");
		this.$el.click(this._onFrameSelect.bind(this))
	},
	setSelected: function StackView_setSelected(index)
	{
		this.$el.children().removeClass("selected").filter('[data-frame="' + index + '"]').addClass("selected");
	},

	_onFrameSelect: function StackView_onFrameSelect(event)
	{
		$f = $(event.target);

		var frameNum = $f.attr("data-frame");

		console.log("frame " + frameNum + " selected.");

		this.trigger(new Dagger.Event(this, "selected", {frame: frameNum}));
	}
});
function StackView(selector)
{
	/*<li class="odd">Galago::IO::SPI::write</li>
	<li class="even selected">Galago::IO::SPI::read</li>
	<li class="odd">main</li>*/

	this.$el = $(selector);
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
	setTitle: function Button_setTitle(title)
	{
		this.$el.html(title);
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
		if(this.action !== false)
			this.trigger(new Dagger.Event(this, "action", {action: this.action}));
	},

	$el: null,
	action: null
});
function Button(selector)
{
	Dagger.Object.call(this);
	this.$el = $(selector);
	this.$el.click(this._onClick.bind(this));
}






IDE.prototype = _.extend(new Dagger.Object(),
{
	init: function IDE_init()
	{
		this.editor = new EditorView("#aceView");
		//editor.open("/Users/kuy/Projects/Galago/ide/ardbeg/testProject/ideTest.cpp");

		this.fileManager = new FileManager(this.editor);

		this.tabs = new TabView("#tabs", this.fileManager);


		this.stackView = new StackView("#stack");
		this.varView = new VarView("#varTree");

		this.verifyRestartButton = new Button("#verifyRestart");
		this.runContinueButton = new Button("#runContinue");
		this.debugPauseButton = new Button("#debugPause");
		this.stopButton = new Button("#stop");

		this.codeTalker = new CodeTalker.CodeTalker("/Users/kuy/Projects/Galago/galago-ide/SDK/bin/arm-elf-gdb", ["--interpreter=mi2", "/Users/kuy/test/module.elf"]);

		this.tabs.listen("selected", function(e)
		{
			this.fileManager.navigate(e.path);
		}, this);

		this.stackView.listen("selected", this.onFrameChange, this);

		this.codeTalker.listen("runstate", function(status)
		{
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
						this.fileManager.navigate(status.reason.frame.file, status.reason.frame.line);
					else if((callstack.length > 0) && (callstack[0].path))
						this.fileManager.navigate(callstack[0].path, callstack[0].line);
					else
						console.log("nowhere to go");

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
		}.bind(this));

		this.codeTalker.listen("breakpointsChanged", function(breakpoints)
		{

		}.bind(this));

		/*this.codeTalker.connect(1034, function(err)
		{
			;
		});*/

		this.varView.setDeferredEvaluator(this.codeTalker.dereferenceVar.bind(this.codeTalker));

		this.fileManager.listen("addBreakpoint", function(event)
		{
			console.log(event);

			//try to find a matching entry in breakpointTable
			for(var i in this.breakpointTable)
				if((this.breakpointTable[i].path == event.path) && (this.breakpointTable[i].line == event.line))
					return;

			this.codeTalker.setBreakpoint(event.path, event.line, function(error, breakpointNum)
			{
				if(error)
					return(this.fileManager.removeBreakpoint(event.path, event.line));
				
				this.breakpointTable.push({path: event.path, line: event.line, num: breakpointNum});
				console.log("add ok");
				
				//delayed by 500ms for demonstration purposes
				setTimeout(function()
				{
					console.log("confirm ok");
					this.fileManager.addBreakpoint(event.path, event.line, "breakpoint");
				}.bind(this), 500);

			}.bind(this));
		}.bind(this));

		this.fileManager.listen("removeBreakpoint", function(event)
		{
			console.log(event);
			
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
					return;	//um?

				this.breakpointTable.splice(breakpointIdx, 1);
				this.fileManager.removeBreakpoint(event.path, event.line);

				console.log("remove ok");
			}.bind(this));
		}.bind(this));

		this.verifyRestartButton.listen("action", this.onButtonStateChange, this);
		this.runContinueButton.listen("action", this.onButtonStateChange, this);
		this.debugPauseButton.listen("action", this.onButtonStateChange, this);
		this.stopButton.listen("action", this.onButtonStateChange, this);



		//finally, enter the root state
		this.setRunState("editing");

		//@@demo
		this.fileManager.navigate("/Users/kuy/Projects/Galago/ide/ardbeg/testProject/ideTest.cpp", 20);
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
			this.verifyRestartButton.setTitle("\u221A").setAction("building");
			this.runContinueButton.setTitle("&gt;").setAction("running");
			this.debugPauseButton.setTitle("&gt;||").setAction("stopped");
			this.stopButton.setTitle("X").setAction(false);
			break;

		case "building":
			this.verifyRestartButton.setTitle("\u221A").setAction(false);
			this.runContinueButton.setTitle("&gt;").setAction(false);
			this.debugPauseButton.setTitle("&gt;||").setAction(false);
			this.stopButton.setTitle("X").setAction("editing");
			break;

		case "running":
			this.verifyRestartButton.setTitle("&lt;&lt;").setAction(false);
			this.runContinueButton.setTitle("&gt;").setAction(false);
			this.debugPauseButton.setTitle("||").setAction("stopped");
			this.stopButton.setTitle("X").setAction("editing");
			break;

		case "stopped":
			this.verifyRestartButton.setTitle("&lt;&lt;").setAction("restart");
			this.runContinueButton.setTitle("&gt;").setAction("running");
			this.debugPauseButton.setTitle("||").setAction(false);
			this.stopButton.setTitle("X").setAction("editing");
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
				this.setAllButtonsEnabled(false);
				
				//(simulated)
				setTimeout(function()
				{
					//@@show build error highlights

					this.setAllButtonsEnabled(true);
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
						console.log("Error: ", error);
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
						console.log("Error: ", error);
					}
					//else codetalker signals the correct state transition automatically
				}.bind(this));
			}
			else if(this.runState == "editing")
			{
				this.setAllButtonsEnabled(false);
				
				//@@determine the correct port from galagoServer
				this.codeTalker.connect(1033, function(error)
				{
					if(error)
					{
						this.setAllButtonsEnabled(true);
						console.log("Error: ", error);
						return;
					}
					
					//@@if the firmware is newer than the last image we installed
					//  flash it

					this.codeTalker.run(function(error)
					{
						if(error)
						{
							this.setRunState("stopped");
							console.log("Error: ", error);
						}
						//else codetalker signals the correct state transition automatically
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
						console.log("Error: ", error);
					}
					//else codetalker signals the correct state transition automatically
				}.bind(this));
			}
			else if(this.runState == "editing")
			{
				this.setAllButtonsEnabled(false);
				
				//@@determine the correct port from galagoServer
				this.codeTalker.connect(1033, function(error)
				{
					if(error)
					{
						this.setAllButtonsEnabled(true);
						console.log("Error: ", error);
					}
					//else codetalker signals the correct state transition (to "stopped") automatically
				}.bind(this));
			}
			break;
		}
	},
	onFrameChange: function IDE_onFrameChange(event)
	{
		if(this.runState != "stopped")
			return;

		this.codeTalker.setVarFrame(event.frame, function(error)
		{
			if(error != undefined)
				return;

			this.updateVarsForFrame();
			var callstack = this.codeTalker.getStack();
			
			if(callstack[event.frame].path)
				this.fileManager.navigate(callstack[event.frame].path, callstack[event.frame].line);
			else
				console.log("can't resolve that frame");

		}.bind(this));
	},

	setAllButtonsEnabled: function IDE_setAllButtonsEnabled(enabled)
	{
		this.verifyRestartButton.setEnabled(enabled);
		this.runContinueButton.setEnabled(enabled);
		this.debugPauseButton.setEnabled(enabled);
		this.stopButton.setEnabled(enabled);
	},

	runState: null,
	breakpointTable: null,

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
function IDE()
{
	this.runState = null;
	this.breakpointTable = [];
}

$(function()
{
	window.ide = new IDE();

	window.ide.init();
})


/*
View.prototype = _.extend(_.clone(DaggerObject.prototype),
{
	show: function View_show()
	{
		;
	},
	hide: function View_hide()
	{
		;
	}
});
function View(parent)
{
	this.parent = parent;
}

HomeView.prototype = _.extend(_.clone(View.prototype),
{
	show: function HomeView_show()
	{
		//fetch and populate news
		//populate recent list

		//wire project search to this.onProjectSearchChange
	},
	hide: function HomeView_hide()
	{
		;
	},
	onProjectSearchChange: function HomeView_onProjectSearchChange(e)
	{
		;
	}
});
function HomeView(parent)
{
	View(parent);
}

RootView.prototype =
{
	switch: function RootView_switch(view)
	{
		if(this._view)
		{
			this._view.hide();
			this._view.ignore("switch", this.onSwitch, this);
		}
		this._view = view;
		if(this._view)
		{
			this._view.show();
			this._view.listen("switch", this.onSwitch, this);
		}
	},
	onSwitch: function RootView_onSwitch(event)
	{
		this.switch(this._views[event.name]);
	},
};
function RootView()
{
	this._homeView = new HomeView(this);
	this._editorView = new EditorView(this);

	this._views =
	{
		home: this._homeView,
		editor: this._editorView,
	}
	this.switch(this._homeView)
}


rootView = new RootView();
*/
