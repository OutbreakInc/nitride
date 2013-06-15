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
var KuyUndoManager = ace.require("ace/undomanager").UndoManager;	//Kuy's slightly enhanced undo manager

//node requirements
var fs = require("fs");

File.prototype = _.extend(_.clone(Dagger.Object.prototype),
{
	path: null,
	document: null,
	needsSave: false,

	close: function File_close()
	{
		this.save(true);
		this.document.removeEventListener("change", this._onChangeListener);
	},

	onFileRead: function File_onFileRead(error, contents)
	{
		console.log("read file yo!")
		
		this.document = new AceDocument(contents);

		this.document.on("change", this._onChangeListener = function(e)
		{
			if(!this.needsSave)
				this.trigger(new Dagger.Event(this, "needsSave"));

			this.needsSave = true;
			this.save();
		}.bind(this));

		this.trigger(new Dagger.Event(this, "load"));
	},

	save: function(force)
	{
		var ths = this;
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
			this.trigger(new Dagger.Event(this, "needsSave"));

		this.needsSave = false;

		console.log("will save now.");

		fs.writeFile(this.path, this.document.getValue(), {encoding: "utf8"})
	}
});
function File(path)
{
	Dagger.Object.call(this);

	if(path)
		fs.readFile(path, {encoding: "utf8"}, this.onFileRead.bind(this));

	this.path = path;
}

EditorView.prototype =
{
	file: null,
	editor: null,
	breakpoints: null,

	init: function EditorView_init()
	{
		this.editor = ace.edit(window.$(".documentView")[0]);

		//this.el.style.fontSize = "11px";

		this.editor.on("guttermousedown", this.onToggleBreakpoint);
		
		with(this.editor)
		{
			setTheme("ace/theme/chrome");
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
			this.editor.setSession(this.session = new AceEditSession(this.file.document));
			this.session.setUndoManager(new KuyUndoManager());
			this.session.setMode(new aceCppMode());
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
	
	onToggleBreakpoint: function EditorView_onToggleBreakpoint(event)
	{
		var target = event.domEvent.target;
			
		if(target.className.indexOf("ace_gutter-cell") == -1) 
			return; 
		if(!event.editor.isFocused()) 
			return; 
		if(event.clientX > 25 + target.getBoundingClientRect().left) 
			return; 

		var row = event.getDocumentPosition().row;

		// rows are zero-indexed, lines are not
		var line = row + 1;	
		
		if(this.breakpoints[row]) 
		{
			this.editor.session.clearBreakpoint(row);
			delete this.breakpoints[row];
			console.log("removing breakpoint from: ", line);
		}
		else 
		{
			this.editor.session.setBreakpoint(row);
			this.breakpoints[row] = true;
			console.log("setting breakpoint to: ", line);
		}
		
		event.stop();
	},
};
function EditorView()
{
	this.breakpoints = {};

	this.onToggleBreakpoint = this.onToggleBreakpoint.bind(this);
}


var editor = new EditorView();

editor.init();

editor.open("/Users/kuy/Projects/Galago/ide/ardbeg/testProject/ideTest.cpp");


// debugger var view:
function trimAndEscape(text, maxLength)
{
	if(typeof text != "string")
		text = String(text);
	if(text.length > maxLength)
		text = text.substr(0, maxLength - 3) + "...";

	return($("<a/>").text(text).html());
}

function formatValue(value, forceHex)
{
	if(_.isNumber(value) && forceHex)
		return("0x" + value.toString(16));
	else if(typeof value == "string")
		return("&quot;" + trimAndEscape(value, 16) + "&quot;");
	else
		return(trimAndEscape(value, 16));
}

function printVar(variable)
{
	var v = "<strong>" + variable.name + "</strong> "

	if(variable.value !== undefined)
		v += formatValue(variable.value, (variable.type.substr(-1) == "*"));

	return(v + " <em>(" + variable.type + ")</em>");
}


function genNode(parentNode, variable)
{
	var childRel = "";
	if(parentNode.id)
		childRel = parentNode.id;

	var id = childRel + variable.name + ((variable.type.substr(-1) == "*")? "->" : ".");
	
	var node = new YAHOO.widget.HTMLNode(
	{
		id: id,
		html: printVar(variable)
	}, parentNode);

	if(variable.children === true)
		node.setDynamicLoad(loadVariable);
	else if(_.isArray(variable.children))
		for(var i in variable.children)
			arguments.callee(node, variable.children[i]);
	else if(variable.children)
	{
		//create a synthetic child node for the dereference of the variable as Xcode does
		var derefType = variable.type;
		if(derefType.substr(-1) == "*")
			derefType = derefType.substr(0, derefType.length - 1);

		new YAHOO.widget.HTMLNode(
		{
			id: "*" + id,
			html: formatValue(variable.children) + " <em>(" + derefType + ")</em>"
		}, node);
	}

	return(node);
}

function loadVariable(node, callback)
{
	console.log("would load: ", node);

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
			genNode(node, fakeVars[i]);

		callback();
	}, 500);
}

var tree = new YAHOO.widget.TreeView($("#varTree")[0]);

var root = this.tree.getRoot();

tree.removeChildren(root);	//fn clear()

var vars =
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
];

for(var i in vars)
	genNode(root, vars[i]);

tree.render();

// /var view



// test breakpoint hit:
var line = 15;
var range = new AceRange(line - 1, 0, line, 0);
editor.editor.getSession().addMarker(range, "ide-line-error", "background");
// /breakpoint

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
