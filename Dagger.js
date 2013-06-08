//((typeof window.jQuery != "undefined")? window.$ : function(f){f();})
(function()
{

this.prototype = window;

_ = window._;
Handlebars = window.Handlebars;

if(!Function.prototype.bind)
	Function.prototype.bind = function(c){var f = this;return(function(){f.apply(c, arguments);});}

function convert_toCamelCase(str)
{
	var o = "", i1 = 0, i2;
	while((i2 = str.indexOf("_", i1)) != -1)
	{
		o += str.substring(i1, i2) + str.substr(++i2, 1).toUpperCase();
		i1 = i2 + 1;
	}
	return(o + str.substr(i1));
}

//creates an API method that has the effective signature:
//create("POST", "/foo/:barID/baz")
//	-> method(barID, [postJSON], callback, [context]);
//create("GET", "/user/:userID/faves/:faveID")
//	-> method(userID, faveID, [queryParams], callback, [context]);
function DaggerAPIMethod(method, urlScheme)
{
	var urlParts = urlScheme
					.split("/").filter(function(p){
							return(p !== "");
						})
					.map(function(p){
							return((p.substr(0, 1) === ":")? null : p);
						});
	
	return(function()
	{
		var url = "";
		var argIdx = 0;
		for(var i = 0; i < urlParts.length; i++)
			url += "/" + (urlParts[i]? urlParts[i] : arguments[argIdx++]);
		
		var data = (typeof(arguments[argIdx]) === "function")? undefined : arguments[argIdx++];
		var callback = arguments[argIdx++];
		var context = arguments[argIdx];
		
		if(typeof(callback) !== "function")
		{
			var e = new Error("No callback function specified when requesting API \"" + url + "\"!");
			e.url = url;
			throw e;
		}
		
		window.$.ajax(url,
		{
			type: method,
			data: data,
			dataType: "json",
			success: function(data, textStatus, jqXHR)
			{
				callback.call(context, data.err, (data.err)? undefined : data);
			}
		});
	});
}
//curry functions
DaggerAPIMethod.get = function(urlScheme){return(DaggerAPIMethod("GET", urlScheme));};
DaggerAPIMethod.post = function(urlScheme){return(DaggerAPIMethod("POST", urlScheme));};

DaggerEventCore =
{
	__nextUID: 1,
	__taskList: {},
	__taskListLen: 0,

	registerTask: function DaggerEventCore_registerTask(emitter)
	{
		if(!(emitter.__callQueuedListeners && emitter.__uid))
			throw new Error("The caller can only register a DaggerObject with this method.");
		
		var uid = emitter.__uid || this.__nextUID++
		if(!this.__taskList[uid])
		{
			this.__taskList[uid] = emitter;
			this.__taskListLen++;
		}
		if(!this.processEventsDebounced)	this.processEventsDebounced = _.debounce(this.processEvents.bind(this), 10);
		this.processEventsDebounced();	//kick off events (debounced)
	},
	processEvents: function DaggerEventCore_processEvents()
	{
		var passes = 0;
		
		do
		{
			var list = this.__taskList;	this.__taskList = {};
			var listLen = this.__taskListLen;	this.__taskListLen = 0;
			
			_.values(list).forEach(function(emitter){emitter.__callQueuedListeners();});
			if(++passes > 10)
				throw new Error("Too many event passes were needed! If your event graph is cyclic, it would result in an infinite loop.");
		}
		while(this.__taskListLen > 0);
	},
	processEventsDebounced: null,
};

DaggerEvent.prototype =
{
	__name: null,
	__sender: null,
	toString: function()	{return("[Dagger Event '" + this.__name + "']");}
};
function DaggerEvent(sender, name, otherValues)
{
	_.extend(this, otherValues);
	Object.defineProperty(this, "__name", {value: name, enumerable: false});
	Object.defineProperty(this, "__sender", {value: sender, enumerable: false});
	Object.defineProperty(this, "__uid", {value: DaggerEventCore.__nextUID++, enumerable: false});
}

DaggerObject.prototype =
{
	//callback: function(context, queuedEvent)
	listen: function DaggerObject_listen(eventName, callback, context)
	{
		(this.__listeners[eventName] || (this.__listeners[eventName] = [])).push({callback: callback, context: context});
	},
	ignore: function DaggerObject_ignore(eventName, callback, context)
	{
		var idx;
		(this.__listeners[eventName] || []).some(function(o, i){
			if((o.callback == callback) && (o.context == o.context))
			{idx = i; return(true);}
		});
		if(idx >= 0) this.__listeners[eventName][idx].splice(idx, 1);
	},
	trigger: function DaggerObject_trigger(event)
	{
		//removed, violates promise: if(!this.__listeners[event.__name] || this.__listeners["*"])	return;
		
		var sig = event.__name + "_" + (event.__sender.__uid || event.__uid || DaggerEventCore.__nextUID++);
		if(!this.__eventQueue[sig])
		{
			this.__eventQueue[sig] = event;
			DaggerEventCore.registerTask(this);
		}
	}
}
function DaggerObject()
{
	Object.defineProperty(this, "__listeners", {value: {}, enumerable: false});
	Object.defineProperty(this, "__eventQueue", {value: {}, enumerable: false});
	Object.defineProperty(this, "__uid", {value: DaggerEventCore.__nextUID++, enumerable: false});
	Object.defineProperty(this, "__callQueuedListeners", {value: function __callQueuedListeners()
		{
			var queue = this.__eventQueue;
			this.__eventQueue = {};

			_.values(queue).forEach(function(queuedEvent)
			{
				var l = this.__listeners[queuedEvent.__name];
				if(l)
					l.forEach(function(o){o.callback.call(o.context, queuedEvent)});
				l = this.__listeners["*"];
				if(l)
					l.forEach(function(o){o.callback.call(o.context, queuedEvent)});
			}.bind(this));
		}, enumerable: false});
}

DaggerArray.prototype = _.extend(_.clone(Array.prototype), DaggerObject.prototype,
{
	set: function DaggerArray_set()
	{
		//use either a clone of arguments[0] or the arguments array itself
		var a = arguments[0];
		if(!(a instanceof Array))	a = arguments;
		else						a = Array.prototype.slice.call(a);

		Array.prototype.unshift.call(a, 0, this.length);	//prepend splice methods
		Array.prototype.splice.apply(this, a);
		return(this);
	},
	refresh: function DaggerArray_refresh()	//fallback for when the array is modified outside the supported methods.
	{
		
	},

	push: function DaggerArray_push()
	{
		//hook elements in arguments
		Array.prototype.slice.call(arguments).forEach(function(o){o.listen("*", this.__echo, this);}.bind(this));
		return(Array.prototype.push.apply(this, arguments));
	},
	pop: function DaggerArray_pop()
	{
		//unhook popped element
		var o = Array.prototype.pop.apply(this, arguments);
		o.ignore("*", this.__echo, this);
		return(o);
	},
	shift: function DaggerArray_shift()
	{
		//unhook prepopped element
		var o = Array.prototype.shift.apply(this, arguments);
		o.ignore("*", this.__echo, this);
		return(o);
	},
	unshift: function DaggerArray_unshift()
	{
		//hook prepushed elements
		Array.prototype.slice.call(arguments).forEach(function(o){o.listen("*", this.__echo, this);}.bind(this));
		return(Array.prototype.unshift.apply(this, arguments));
	},

	splice: function DaggerArray_splice()
	{
		return(this.spliceItems.apply(this, arguments));
	},
	spliceItems: function DaggerArray_spliceItems(offset, numItemsToRemove, items__n)
	{
		return(Array.prototype.splice.apply(this, a));
	},
	spliceArray: function DaggerArray_spliceArray(offset, numItemsToRemove, itemArray)
	{
		Array.prototype.unshift.call(a, offset, numItemsToRemove);	//prepend splice methods
		return(Array.prototype.splice.apply(this, a));
	}
});
function DaggerArray()
{
	DaggerObject.apply(this);
	Object.defineProperty(this, "length", {value: 0, enumerable: false});
	Object.defineProperty(this, "__added", {value: [], enumerable: false});
	Object.defineProperty(this, "__removed", {value: [], enumerable: false});
	Object.defineProperty(this, "__echo", {value: function DaggerArray__echo(event)
	{
		this.trigger(event);
	}, enumerable: false});
	this.set.apply(this, arguments);
}

_daggerModel =
{
	//set("propertyName":String, value:*):void -> set the named property to the specified value
	//set(value:*):void -> set the entire state to the specified value
	set: function(name, value)
	{
		if(name == undefined)	return;
		if(arguments.length == 1)
		{
			_.keys(name).forEach(function(k){this.set(k, name[k]);}.bind(this));
			return;
		}
		
		var d = this._decl[name];
		if(d == undefined)
			throw new Error("Cannot set a value for a property name not described by the model for this datum.");
		
		if(d.array)
		{
			if((!(value instanceof Array)) || (typeof(value[0]) != d.type))
				throw new Error("The model for this datum requires an array of " + d.type + "s for the '" + name + "' property.");
		}
		else if(d.type == "model")
		{
			if(!(value instanceof d.model))
				value = new d.model(value);		//construct it!
		}
		else if(typeof(value) != d.type)
			throw new Error("The model for this datum requires a(n) " + d.type + " value for this property.");
		
		this[name] = value;
		var e = {value: value};
		this.trigger(new DaggerEvent(this, "changed:" + name, e));
		this.trigger(new DaggerEvent(this, "changed", e));
	}
};
function _generateDecl(d)
{
	var nd;
	if(typeof d === "object")
	{
		if(d instanceof Array)
		{
			nd = _generateDecl(d[0]);
			nd.array = true;
		}
		else
		{
			nd = {type: "object", inner: {}};
			_.keys(d).forEach(function(k)
			{
				nd.inner[k] = _generateDecl(d[k]);
			});
		}
	}
	else if(d === String)
		nd = {type: "string"};
	else if(d === Number)
		nd = {type: "number"};
	else if(d === Date)
		nd = {type: "date"};
	else if(typeof(d) === "string")	//foreign model
		nd = {type: "model", model: d};
	else
		throw new Error("Unsupported type (" + (typeof d) + ") in model declaration.");

	return(nd);
}
function DaggerDefineModel(decl, impl)
{
	var d = _generateDecl(decl);
	var proto = _.extend(_.clone(DaggerObject.prototype), _daggerModel, {_decl: (d.inner || d)}, impl);
	Object.defineProperty(proto, "_decl", {value: proto._decl, enumerable: false});
		
	var ctor = function DaggerModel_ctor(state)
	{
		DaggerObject.call(this);
		
		_.keys(this._decl).forEach(function(n)
		{
			var t = this._decl[n];
			if(t.array)
				this[n] = new DaggerArray();
			else if(t.type == "string")
				this[n] = "";
			else if(t.type == "number")
				this[n] = 0;
			else if(t.type == "date")
				this[n] = new Date();
			else
				this[n] = null;	//better default?
		}.bind(this));

		this.set(state);
		
		if(this.init)
			this.init.apply(this, arguments);
	};
	ctor.prototype = proto;
	return(ctor);
}

function DaggerDefineRelatedModels(models)
{
	var iterateObject = function(o)
	{
		_.keys(o).forEach(function(d)
		{
			d = o[d];
			if(d.type === "object")
				iterateObject(d.inner);
			else if((d.type === "model") && models[d.model])		//try to resolve the model name against other declared models
				d.model = models[d.model];
		});
	};
	
	_.keys(models).forEach(function(m){iterateObject(models[m].prototype._decl)});	//iterate through each declaration
	
	return(models);
}

_daggerView =
{
	init: function()
	{
		this.compile();
		if(this.dataEvents)
			_.keys(this.dataEvents).forEach(function(k)
			{
				this.data.listen(k, this.dataEvents[k], this);
			}.bind(this));
	},
	deinit: function()
	{
		_.keys(this.dataEvents).forEach(function(k)
		{
			this.data.ignore(k, this.dataEvents[k], this);
		}.bind(this));
	},
	compile: function()
	{
		if(this.template.substr(0, 1) == "#")	//attach to an existing element in the DOM
		{
			this._hb = this.render;
		}
		else
		{
			this._$hbs = window.$("script").filter('[data-view="' + this.template + '"]');
			var script = this._$hbs.html();
			this._hb = script? Handlebars.compile(script) : function(){return("");};
		}
		//console.log(this);
	},
	render: function()
	{
		if(!this._hb)
		{
			this.compile();
			return(this.render());	//recurse because render() may be rebound
		}
		var html = this._hb(this.data || {});
		if(this.$el)	this.$el.html(html);
		else			this._$hbs.after(this.$el = window.$(html));
	}
};
function DaggerDefineView(impl)
{
	var proto = _.extend(_.clone(_daggerView), impl, {_super: _daggerView.init});
	var ctor = function(data)
	{
		if(!(this.data = data))
			throw new Error("You must instantiate a view with an array of data to back it.");
		
		this.init.apply(this, arguments);
	};
	ctor.prototype = proto;
	return(ctor);
}

function DaggerDefineHelpers(selector, fn)
{
	if((selector !== undefined) && (typeof selector != "string"))
		throw new Error("A helper name must be a string, and may be a simple CSS selector");

	if(fn != undefined)
	{
		Handlebars.registerhelper(selector, fn);
	}
	else
	{
		switch(selector? selector.substr(0, 1) : "")
		{
		case ".":
		case "#":
			break;
		default:
			selector = selector? '[data-helper="' + selector + '"]' : "[data-helper]";
		}
		
		window.$("script").filter(selector).each(function(idx, script)
		{
			$s = window.$(script);
			Handlebars.registerPartial($s.attr("data-helper"), $s.html());
		});
	}
}

Dagger =
{
	_: _,
	Handlebars: Handlebars,
	Test: function(jq){return(jq? jq : window.$);},

	Event: DaggerEvent,
	Object: DaggerObject,
	Array: DaggerArray,
	
	API: DaggerAPIMethod,
	
	DefineModel: DaggerDefineModel,
	DefineRelatedModels: DaggerDefineRelatedModels,
	DefineView: DaggerDefineView,
	DefineHelper: DaggerDefineHelpers,
	DefineHelpers: DaggerDefineHelpers
};

module.exports = Dagger;

})();

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


/*

API =
{
	home:
	{
		get: Dagger.API.get("/v1/home"),
	},
	orders:
	{
		get: Dagger.API.get("/v1/orders/:orderID"),
		addRemoveSKUs: Dagger.API.post("/v1/orders/:orderID/skus"),
		purchase: Dagger.API.post("/v1/orders/:orderID"),
	},
	blogs:
	{
		getRecent: Dagger.API.get("/v1/blogs"),
		get: Dagger.API.get("/v1/blogs/:blogID"),
	},
	products:
	{
		get: Dagger.API.get("/v1/products/:productID"),
		getSummary: Dagger.API.get("/v1/products/:summaryID/summary"),
	},
};

Models = Dagger.DefineRelatedModels(
{
	User: Dagger.DefineModel(
		{
			id: String,
			username: String
		},
		{
			init: function(data)
			{
				_.extend(this, data);
			},
			load: function()
			{
			}
		}),
	
	Question: Dagger.DefineModel(
		{
			id: String,
			created: Date,
			modified: Date,
			author: "User",
			title: String,
			replies: [
			{
				id: String
			}]
		},
		{
		}),
	
	Sku: Dagger.DefineModel(
		{
			id: String,
			name: String,
			desc: String,
			products: [
				{
					product: "Product",
					qty: Number
				}
			],
			price: Number
		},
		{
		}),
	
	Product: Dagger.DefineModel(
		{
			id: String,
			name: String,
			desc: String,
			skus: ["Sku"]
		},
		{
		}),
	
	Order: Dagger.DefineModel(
		{
			id: String,
			created: Date,
			modified: Date,
			total: Number,
			paid: Number,
			balance: Number,
			status: String,
			skus: [
				{
					id: String,
					name: String,
					desc: String,
					qty: Number,
					linePrice: Number
				}
			]
		},
		{
		}),
	
	Navigation: Dagger.DefineModel(
		{
			sections: [
				{
					title: String,
					href: String
				}
			]
		},
		{
		}),
	
	Blog: Dagger.DefineModel(
		{
			recent: ["Question"]
		},
		{
		}),
		
	NewProducts: Dagger.DefineModel(
		{
			featured: ["Product"]
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
			newProducts: "NewProducts",
			recentBlogs: "Blog",
			recentProjects: ["Project"]
		},
		{
			refresh: function(){API.home.get(function(err, data)
			{
				if(err)
					return;	//@@show error
				this.set(data);
			});},
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
				changed: function()
				{
					console.log("Whoa!", arguments);
				}
			}
		}),
	Home: Dagger.DefineView(
		{
			template: "home",
			
			blogView: null,
			
			thumbViews: null,
			
			init: function()
			{
				this._super();
				
				this.blogView = new Views.Blog(this.data.recentBlogs = new Models.Blog());
				
				this.thumbViews = new Views.ProjectThumb(this.data.recentProjects = new Dagger.Array());
			},
			method: function()
			{
				console.log("foo");
			}
		}),
};

//this view instance exists outside any section of the site
var navView = new Views.Navigation(new Models.Navigation());

var homeView = new Views.Home(new Models.Home());

navView.data.set({sections:[{title:"foo1",href:"#bar1"}, {title:"foo2",href:"#bar2"}]});

homeView.data.recentProjects.push(new Models.Project({name:"hello",date:"yesterday"}))

//});


*/
