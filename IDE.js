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

		if(this.force)
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

		console.log("will save now.");
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
	
	getScrollOffset: function EditorView_getScrollOffset()
	{
		;
	},
	jumpToLine: function EditorView_jumpToLine(lineNumber)
	{
		this.editor.scrollToLine(lineNumber, true);
	},
	
	highlightStoppedLine: function EditorView_highlightStoppedLine(lineNumber, scrollTo)
	{
		if((lineNumber == undefined) || (this.stoppedMarker != undefined))
		{
			//remove
			this.editor.getSession().removeMarker(this.stoppedMarker);
			this.stoppedMarker = undefined;
		}

		var range = new AceRange(lineNumber - 1, 0, lineNumber, 0);
		this.stoppedMarker = this.editor.getSession().addMarker(range, "ide-line-error", "background");

		if(scrollTo)
			this.jumpToLine(lineNumber);
	},

	//clicking in the gutter requests a breakpoint, and an unrealized breakpoint is displayed.
	//  if the breakpoint becomes set, it is displayed as a proper breakpoint
	//  if that fails, the unrealized breakpoint is removed
	onToggleBreakpoint: function EditorView_onToggleBreakpoint(event)
	{
		var target = event.domEvent.target;
			
		if(target.className.indexOf("ace_gutter-cell") == -1) 
			return; 
		//if(!event.editor.isFocused()) 
		//	return; 
		if(event.clientX > 25 + target.getBoundingClientRect().left) 
			return; 

		var row = event.getDocumentPosition().row;

		// rows are zero-indexed, lines are not
		var line = row + 1;	
		
		if(this.breakpoints[row]) 
		{
			this.editor.session.clearBreakpoint(row);
			delete this.breakpoints[row];
			this.trigger(new Dagger.Event(this, "removeBreakpoint", {file: this.file.path, line: line}));
		}
		else 
		{
			this.editor.session.setBreakpoint(row);
			this.breakpoints[row] = true;
			this.trigger(new Dagger.Event(this, "addBreakpoint", {file: this.file.path, line: line}));
		}
		
		event.stop();
	},
});
function EditorView(selector)
{
	Dagger.Object.call(this);
	this.breakpoints = {};

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
			$f.attr("data-path", event.path);
			$f.addClass("active");
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
		console.log("clicked on: ", event);
		var $tab = $();

		//confirm it's an li element
		this.trigger(new Dagger.Event(this, "selected", {path: $tab.attr("data-path")}));
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
	},

	//line and highlightStoppedPoint are optional
	navigate: function FileManager_navigate(path, line, highlightStoppedPoint)
	{
		var f;
		if(path != this.currentPath)
		{
			this.editor.close();

			f = this.filesByPath[this.currentPath = path];
			if(f == undefined)
			{
				f = this.filesByPath[this.currentPath] =
				{
					path: path,
					lastOffset: 0,	//updated below
					lastAccessed: Date.now()
				};
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
		}
		else
			f = this.filesByPath[this.currentPath];

		if(line != undefined)
		{
			this.editor.listen("opened", function()
			{
				this.editor.ignore("opened", arguments.callee);
				this.editor.jumpToLine(f.lastOffset = line);
				if(highlightStoppedPoint)
					this.editor.highlightStoppedLine(line);
			}, this);
		}

		this.trigger(new Dagger.Event(this, "navigated", {path: this.currentPath}));
		this.trigger(new Dagger.Event(this, "changed"));
	},

	editor: null,
	currentPath: null,
	filesByPath: null,
	filesByLRU: null,
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

		if(variable.value !== undefined)
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


var varView = new VarView("#varTree");

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








StackView.prototype =
{
	$el: null,

	setData: function StackView_setData(data)
	{
		this.clear();

		this.data = data;

		for(var i = 0; i < data.length; i++)
		{
			$line = $("<li/>");
			$line.html(data[i].func);
			$line.addClass((i & 1)? "odd" : "even");
			if(i == 0)
				$line.addClass("selected");
			$line.attr("data-frame", i);
			this.$el.append($line);
		}
	},
	clear: function StackView_clear()
	{
		this.$el.html("");
		this.$el.click(this._onFrameSelect.bind(this))
	},

	_onFrameSelect: function StackView_onFrameSelect(e)
	{
		$e = $(e);

		var frameNum = $e.attr("data-frame");

		console.log("frame " + frameNum + " selected.");
	}
};
function StackView(selector)
{
	/*<li class="odd">Galago::IO::SPI::write</li>
	<li class="even selected">Galago::IO::SPI::read</li>
	<li class="odd">main</li>*/

	this.$el = $(selector);
}

var stackView = new StackView("#stack");

//stackView.setData(["Galago::IO::SPI::write", "Galago::IO::SPI::read", "main"]);	//@@test




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









var editor = new EditorView("#aceView");
//editor.open("/Users/kuy/Projects/Galago/ide/ardbeg/testProject/ideTest.cpp");

var fileManager = new FileManager(editor);

var tabs = new TabView("#tabs", fileManager);

tabs.listen("select", function(e)
{
	fileManager.navigate(e.path);
});

var codeTalker = new CodeTalker.CodeTalker("/Users/kuy/Projects/Galago/galago-ide/SDK/bin/arm-elf-gdb", ["--interpreter=mi2", "/Users/kuy/Projects/Galago/ide/ardbeg/testProject/module.elf"]);

codeTalker.listen("runstate", function(status)
{
	switch(status.state)
	{
	case "stopped":
		console.log(">>> UI set for stopped mode <<< ");
		
		//highlight the stopped line
		//editor.highlightStoppedLine(10);
		fileManager.navigate(status.reason.frame.file, status.reason.frame.line, true);
		
		codeTalker.updateCallstack(function(err)
		{
			//update UI
			stackView.setData(codeTalker.getStack());
		});

		codeTalker.updateVars(function(err)
		{
			//update UI
			varView.setData(codeTalker.getVars());
		});
		
		break;
	case "running":
		console.log(">>> UI set for run mode <<<");
		break;
	}
});

codeTalker.listen("breakpointsChanged", function(breakpoints)
{
	editor.setBreakpoints();
});

codeTalker.connect(1033, function(err)
{
	;
});

varView.setDeferredEvaluator(codeTalker.dereferenceVar.bind(codeTalker));

editor.listen("addBreakpoint", function(event)
{
	console.log(event);
	codeTalker.setBreakpoint(event.file, event.line);
});

editor.listen("removeBreakpoint", function(event)
{
	console.log(event);
	codeTalker.removeBreakpoint(event.file, event.line);
});




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
