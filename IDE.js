var Dagger = require("./Dagger.js");

var Moduleverse = require("moduleverse");

var ace = window.ace;
var aceRange = ace.require("ace/range").Range;
var aceCppMode = ace.require("ace/mode/c_cpp").Mode;


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
			date: String
		},
		{
		}),
	Home: Dagger.DefineModel(
		{
			recentNews: ["News"],
			recentProjects: ["Project"],
			projectSearch: String
		},
		{
			refresh: function()
			{
				console.log("would pull new news data now");
			},
		}), 
});

function Render()
{
	this.render();
}

Views =
{
	Navigation: Dagger.DefineView(
		{
			template: "topNavigation",
			dataEvents:
			{
				changed: Render
			}
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

			init: function()
			{
				this._super();
				
				this.blogView = new Views.Blog(this.data.recentNews);
				this.projectThumbView = new Views.ProjectThumb(this.data.recentProjects);

				window.$("#projectSearch").change(this.onProjectSearchChange.bind(this))
					.keydown(this.onProjectSearchChange.bind(this));
			},
			render: function(data)
			{
				console.log("rendering home with data: ", data);
			},
			onProjectSearchChange: _.debounce(function(e)
			{
				console.log(e);
			}, 300)
		}),
};

function aceStart()
{
		var editor = ace.edit(window.$(".documentView")[0]);

		editor.setTheme("ace/theme/chrome");
		
		//this.el.style.fontSize = "11px";

		var session = editor.getSession();
		session.setMode(new aceCppMode());
		//this.dirty = true;
		
		setTimeout(function()
		{	
			editor.setBehavioursEnabled(false);
			editor.setShowPrintMargin(false);
			editor.setHighlightActiveLine(false);
			editor.setSelectionStyle("line");
			editor.session.setUseSoftTabs(false);
			
		}.bind(this), 100);	//this should be done when ACE emits an event that I don't yet know about
}

function init()
{
	Dagger.DefineHelpers();

	//this view instance exists outside any section of the site
	var navView = new Views.Navigation(new Models.Navigation());

	var homeView = new Views.Home(new Models.Home());

	navView.data.set({projects:[{title:"main.cpp", href:"#/test/main.cpp"}, {title:"GalagoAPI.cpp", href:"#/logiblock+platform/galago/GalagoAPI.cpp"}]});

	homeView.data.recentNews.push(new Models.News({title:"announcement", author:{id: "1"}, body:"hello world!"}));
	homeView.data.recentProjects.push(new Models.Project({name:"hello", date:"yesterday"}));

	aceStart();
}

module.exports =
{
	Dagger: Dagger,
	init: init
};
