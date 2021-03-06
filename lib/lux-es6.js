/**
 * lux.js - Flux-based architecture for using ReactJS at LeanKit
 * Author: Jim Cowart
 * Version: v0.7.4
 * Url: https://github.com/LeanKit-Labs/lux.js
 * License(s): MIT Copyright (c) 2015 LeanKit
 */


( function( root, factory ) {
	/* istanbul ignore next - don't test UMD wrapper */
	if ( typeof define === "function" && define.amd ) {
		// AMD. Register as an anonymous module.
		define( [ "postal", "machina", "lodash" ], factory );
	} else if ( typeof module === "object" && module.exports ) {
		// Node, or CommonJS-Like environments
		module.exports = factory( require( "postal" ), require( "machina" ), require( "lodash" ) );
	} else {
		root.lux = factory( root.postal, root.machina, root._ );
	}
}( this, function( postal, machina, _ ) {
	/* istanbul ignore next */
	if ( !( typeof global === "undefined" ? window : global )._babelPolyfill ) {
		throw new Error( "You must include the babel polyfill on your page before lux is loaded. See https://babeljs.io/docs/usage/polyfill/ for more details." );
	}

	var actionChannel = postal.channel( "lux.action" );
	var storeChannel = postal.channel( "lux.store" );
	var dispatcherChannel = postal.channel( "lux.dispatcher" );
	var stores = {};

	// jshint ignore:start
	var entries = function* ( obj ) {
		if ( [ "object", "function" ].indexOf( typeof obj ) === -1 ) {
			obj = {};
		}
		for ( var k of Object.keys( obj ) ) {
			yield [ k, obj[ k ] ];
		}
	};
	// jshint ignore:end

	function ensureLuxProp( context ) {
		var __lux = context.__lux = ( context.__lux || {} );
		var cleanup = __lux.cleanup = ( __lux.cleanup || [] );
		var subscriptions = __lux.subscriptions = ( __lux.subscriptions || {} );
		return __lux;
	}

	var React;

	var extend = function( ...options ) {
		var parent = this;
		var store; // placeholder for instance constructor
		var storeObj = {}; // object used to hold initialState & states from prototype for instance-level merging
		var Ctor = function() {}; // placeholder ctor function used to insert level in prototype chain

		// First - separate mixins from prototype props
		var mixins = [];
		for ( var opt of options ) {
			mixins.push( _.pick( opt, [ "handlers", "state" ] ) );
			delete opt.handlers;
			delete opt.state;
		}

		var protoProps = _.merge.apply( this, [ {} ].concat( options ) );

		// The constructor function for the new subclass is either defined by you
		// (the "constructor" property in your `extend` definition), or defaulted
		// by us to simply call the parent's constructor.
		if ( protoProps && protoProps.hasOwnProperty( "constructor" ) ) {
			store = protoProps.constructor;
		} else {
			store = function() {
				var args = Array.from( arguments );
				args[ 0 ] = args[ 0 ] || {};
				parent.apply( this, store.mixins.concat( args ) );
			};
		}

		store.mixins = mixins;

		// Inherit class (static) properties from parent.
		_.merge( store, parent );

		// Set the prototype chain to inherit from `parent`, without calling
		// `parent`'s constructor function.
		Ctor.prototype = parent.prototype;
		store.prototype = new Ctor();

		// Add prototype properties (instance properties) to the subclass,
		// if supplied.
		if ( protoProps ) {
			_.extend( store.prototype, protoProps );
		}

		// Correctly set child's `prototype.constructor`.
		store.prototype.constructor = store;

		// Set a convenience property in case the parent's prototype is needed later.
		store.__super__ = parent.prototype;
		return store;
	};

	

var actions = Object.create( null );
var actionGroups = {};

function buildActionList( handlers ) {
	var actionList = [];
	for ( var [ key, handler ] of entries( handlers ) ) {
		actionList.push( {
			actionType: key,
			waitFor: handler.waitFor || []
		} );
	}
	return actionList;
}

function publishAction( action, ...args ) {
	if ( actions[ action ] ) {
		actions[ action ]( ...args );
	} else {
		throw new Error( `There is no action named '${action}'` );
	}
}

function generateActionCreator( actionList ) {
	actionList = ( typeof actionList === "string" ) ? [ actionList ] : actionList;
	actionList.forEach( function( action ) {
		if ( !actions[ action ] ) {
			actions[ action ] = function() {
				var args = Array.from( arguments );
				actionChannel.publish( {
					topic: `execute.${action}`,
					data: {
						actionType: action,
						actionArgs: args
					}
				} );
			};
		}
	} );
}

function getActionGroup( group ) {
	if ( actionGroups[ group ] ) {
		return _.pick( actions, actionGroups[ group ] );
	} else {
		throw new Error( `There is no action group named '${group}'` );
	}
}

function customActionCreator( action ) {
	actions = Object.assign( actions, action );
}

function addToActionGroup( groupName, actionList ) {
	var group = actionGroups[ groupName ];
	if ( !group ) {
		group = actionGroups[ groupName ] = [];
	}
	actionList = typeof actionList === "string" ? [ actionList ] : actionList;
	var diff = _.difference( actionList, Object.keys( actions ) );
	if ( diff.length ) {
		throw new Error( `The following actions do not exist: ${diff.join( ", " )}` );
	}
	actionList.forEach( function( action ) {
		if ( group.indexOf( action ) === -1 ) {
			group.push( action );
		}
	} );
}

	



/*********************************************
*                 Store Mixin                *
**********************************************/
function gateKeeper( store, data ) {
	var payload = {};
	payload[ store ] = true;
	var __lux = this.__lux;

	var found = __lux.waitFor.indexOf( store );

	if ( found > -1 ) {
		__lux.waitFor.splice( found, 1 );
		__lux.heardFrom.push( payload );

		if ( __lux.waitFor.length === 0 ) {
			__lux.heardFrom = [];
			this.stores.onChange.call( this, payload );
		}
	} else {
		this.stores.onChange.call( this, payload );
	}
}

function handlePreNotify( data ) {
	this.__lux.waitFor = data.stores.filter(
		( item ) => this.stores.listenTo.indexOf( item ) > -1
	);
}

var luxStoreMixin = {
	setup: function() {
		var __lux = ensureLuxProp( this );
		var stores = this.stores = ( this.stores || {} );

		if ( !stores.listenTo || !stores.listenTo.length ) {
			throw new Error( `listenTo must contain at least one store namespace` );
		}

		var listenTo = typeof stores.listenTo === "string" ? [ stores.listenTo ] : stores.listenTo;

		if ( !stores.onChange ) {
			throw new Error( `A component was told to listen to the following store(s): ${listenTo} but no onChange handler was implemented` );
		}

		__lux.waitFor = [];
		__lux.heardFrom = [];

		listenTo.forEach( ( store ) => {
			__lux.subscriptions[ `${store}.changed` ] = storeChannel.subscribe( `${store}.changed`, () => gateKeeper.call( this, store ) );
		} );

		__lux.subscriptions.prenotify = dispatcherChannel.subscribe( "prenotify", ( data ) => handlePreNotify.call( this, data ) );
	},
	teardown: function() {
		for ( var [ key, sub ] of entries( this.__lux.subscriptions ) ) {
			var split;
			if ( key === "prenotify" || ( ( split = key.split( "." ) ) && split.pop() === "changed" ) ) {
				sub.unsubscribe();
			}
		}
	},
	mixin: {}
};

var luxStoreReactMixin = {
	componentWillMount: luxStoreMixin.setup,
	componentWillUnmount: luxStoreMixin.teardown
};

/*********************************************
*           Action Creator Mixin          *
**********************************************/

var luxActionCreatorMixin = {
	setup: function() {
		this.getActionGroup = this.getActionGroup || [];
		this.getActions = this.getActions || [];

		if ( typeof this.getActionGroup === "string" ) {
			this.getActionGroup = [ this.getActionGroup ];
		}

		if ( typeof this.getActions === "string" ) {
			this.getActions = [ this.getActions ];
		}

		var addActionIfNotPresent = ( k, v ) => {
			if ( !this[ k ] ) {
				this[ k ] = v;
			}
		};
		this.getActionGroup.forEach( ( group ) => {
			for ( var [ k, v ] of entries( getActionGroup( group ) ) ) {
				addActionIfNotPresent( k, v );
			}
		} );

		if ( this.getActions.length ) {
			this.getActions.forEach( function( key ) {
				addActionIfNotPresent( key, function() {
					publishAction( key, ...arguments );
				} );
			} );
		}
	},
	mixin: {
		publishAction: publishAction
	}
};

var luxActionCreatorReactMixin = {
	componentWillMount: luxActionCreatorMixin.setup,
	publishAction: publishAction
};

/*********************************************
*            Action Listener Mixin           *
**********************************************/
var luxActionListenerMixin = function( { handlers, handlerFn, context, channel, topic } = {} ) {
	return {
		setup() {
			context = context || this;
			var __lux = ensureLuxProp( context );
			var subs = __lux.subscriptions;
			handlers = handlers || context.handlers;
			channel = channel || actionChannel;
			topic = topic || "execute.*";
			handlerFn = handlerFn || ( ( data, env ) => {
				var handler;
				if ( handler = handlers[ data.actionType ] ) {
					handler.apply( context, data.actionArgs );
				}
			} );
			if ( !handlers || !Object.keys( handlers ).length ) {
				throw new Error( "You must have at least one action handler in the handlers property" );
			} else if ( subs && subs.actionListener ) {
				// TODO: add console warn in debug builds
				// since we ran the mixin on this context already
				return;
			}
			subs.actionListener = channel.subscribe( topic, handlerFn ).context( context );
			var handlerKeys = Object.keys( handlers );
			generateActionCreator( handlerKeys );
			if ( context.namespace ) {
				addToActionGroup( context.namespace, handlerKeys );
			}
		},
		teardown() {
			this.__lux.subscriptions.actionListener.unsubscribe();
		}
	};
};

/*********************************************
*   React Component Versions of Above Mixin  *
**********************************************/
function ensureReact( methodName ) {
	if ( typeof React === "undefined" ) {
		throw new Error( "You attempted to use lux." + methodName + " without first calling lux.initReact( React );" );
	}
}

function controllerView( options ) {
	ensureReact( "controllerView" );
	var opt = {
		mixins: [ luxStoreReactMixin, luxActionCreatorReactMixin ].concat( options.mixins || [] )
	};
	delete options.mixins;
	return React.createClass( Object.assign( opt, options ) );
}

function component( options ) {
	ensureReact( "component" );
	var opt = {
		mixins: [ luxActionCreatorReactMixin ].concat( options.mixins || [] )
	};
	delete options.mixins;
	return React.createClass( Object.assign( opt, options ) );
}

/*********************************************
*   Generalized Mixin Behavior for non-lux   *
**********************************************/
var luxMixinCleanup = function() {
	this.__lux.cleanup.forEach( ( method ) => method.call( this ) );
	this.__lux.cleanup = undefined;
	delete this.__lux.cleanup;
};

function mixin( context, ...mixins ) {
	if ( mixins.length === 0 ) {
		mixins = [ luxStoreMixin, luxActionCreatorMixin ];
	}

	mixins.forEach( ( mixin ) => {
		if ( typeof mixin === "function" ) {
			mixin = mixin();
		}
		if ( mixin.mixin ) {
			Object.assign( context, mixin.mixin );
		}
		if ( typeof mixin.setup !== "function" ) {
			throw new Error( "Lux mixins should have a setup method. Did you perhaps pass your mixins ahead of your target instance?" );
		}
		mixin.setup.call( context );
		if ( mixin.teardown ) {
			context.__lux.cleanup.push( mixin.teardown );
		}
	} );
	context.luxCleanup = luxMixinCleanup;
	return context;
}

mixin.store = luxStoreMixin;
mixin.actionCreator = luxActionCreatorMixin;
mixin.actionListener = luxActionListenerMixin;

var reactMixin = {
	actionCreator: luxActionCreatorReactMixin,
	store: luxStoreReactMixin
};

function actionListener( target ) {
	return mixin( target, luxActionListenerMixin );
}

function actionCreator( target ) {
	return mixin( target, luxActionCreatorMixin );
}

function actionCreatorListener( target ) {
	return actionCreator( actionListener( target ) );
}

	


function ensureStoreOptions( options, handlers, store ) {
	var namespace = ( options && options.namespace ) || store.namespace;
	if ( namespace in stores ) {
		throw new Error( `The store namespace "${namespace}" already exists.` );
	}
	if ( !namespace ) {
		throw new Error( "A lux store must have a namespace value provided" );
	}
	if ( !handlers || !Object.keys( handlers ).length ) {
		throw new Error( "A lux store must have action handler methods provided" );
	}
}

function getHandlerObject( handlers, key, listeners ) {
	return {
		waitFor: [],
		handler: function() {
			var changed = 0;
			var args = Array.from( arguments );
			listeners[ key ].forEach( function( listener ) {
				changed += ( listener.apply( this, args ) === false ? 0 : 1 );
			}.bind( this ) );
			return changed > 0;
		}
	};
}

function updateWaitFor( source, handlerObject ) {
	if ( source.waitFor ) {
		source.waitFor.forEach( function( dep ) {
			if ( handlerObject.waitFor.indexOf( dep ) === -1 ) {
				handlerObject.waitFor.push( dep );
			}
		} );
	}
}

function addListeners( listeners, key, handler ) {
	listeners[ key ] = listeners[ key ] || [];
	listeners[ key ].push( handler.handler || handler );
}

function processStoreArgs( ...options ) {
	var listeners = {};
	var handlers = {};
	var state = {};
	var otherOpts = {};
	options.forEach( function( o ) {
		var opt;
		if ( o ) {
			opt = _.clone( o );
			_.merge( state, opt.state );
			if ( opt.handlers ) {
				Object.keys( opt.handlers ).forEach( function( key ) {
					var handler = opt.handlers[ key ];
					// set up the actual handler method that will be executed
					// as the store handles a dispatched action
					handlers[ key ] = handlers[ key ] || getHandlerObject( handlers, key, listeners );
					// ensure that the handler definition has a list of all stores
					// being waited upon
					updateWaitFor( handler, handlers[ key ] );
					// Add the original handler method(s) to the listeners queue
					addListeners( listeners, key, handler );
				} );
			}
			delete opt.handlers;
			delete opt.state;
			_.merge( otherOpts, opt );
		}
	} );
	return [ state, handlers, otherOpts ];
}

class Store {

	constructor( ...opt ) {
		var [ state, handlers, options ] = processStoreArgs( ...opt );
		ensureStoreOptions( options, handlers, this );
		var namespace = options.namespace || this.namespace;
		Object.assign( this, options );
		stores[ namespace ] = this;
		var inDispatch = false;
		this.hasChanged = false;

		this.getState = function() {
			return state;
		};

		this.setState = function( newState ) {
			if ( !inDispatch ) {
				throw new Error( "setState can only be called during a dispatch cycle from a store action handler." );
			}
			state = Object.assign( state, newState );
		};

		this.replaceState = function( newState ) {
			if ( !inDispatch ) {
				throw new Error( "replaceState can only be called during a dispatch cycle from a store action handler." );
			}
			// we preserve the underlying state ref, but clear it
			Object.keys( state ).forEach( function( key ) {
				delete state[ key ];
			} );
			state = Object.assign( state, newState );
		};

		this.flush = function flush() {
			inDispatch = false;
			if ( this.hasChanged ) {
				this.hasChanged = false;
				storeChannel.publish( `${this.namespace}.changed` );
			}
		};

		mixin( this, luxActionListenerMixin( {
			context: this,
			channel: dispatcherChannel,
			topic: `${namespace}.handle.*`,
			handlers: handlers,
			handlerFn: function( data, envelope ) {
				if ( handlers.hasOwnProperty( data.actionType ) ) {
					inDispatch = true;
					var res = handlers[ data.actionType ].handler.apply( this, data.actionArgs.concat( data.deps ) );
					this.hasChanged = ( res === false ) ? false : true;
					dispatcherChannel.publish(
						`${this.namespace}.handled.${data.actionType}`,
						{ hasChanged: this.hasChanged, namespace: this.namespace }
					);
				}
			}.bind( this )
		} ) );

		this.__subscription = {
			notify: dispatcherChannel.subscribe( `notify`, () => this.flush() )
					.constraint( () => inDispatch )
		};

		dispatcher.registerStore(
			{
				namespace,
				actions: buildActionList( handlers )
			}
		);
	}

	// Need to build in behavior to remove this store
	// from the dispatcher's actionMap as well!
	dispose() {
		for ( var [ k, subscription ] of entries( this.__subscription ) ) {
			subscription.unsubscribe();
		}
		delete stores[ this.namespace ];
		dispatcher.removeStore( this.namespace );
		this.luxCleanup();
	}
}

Store.extend = extend;

function removeStore( namespace ) {
	stores[ namespace ].dispose();
}

	

function calculateGen( store, lookup, gen, actionType, namespaces ) {
	var calcdGen = gen;
	var _namespaces = namespaces || [];
	if ( _namespaces.indexOf( store.namespace ) > -1 ) {
		throw new Error( `Circular dependency detected for the "${store.namespace}" store when participating in the "${actionType}" action.` );
	}
	if ( store.waitFor && store.waitFor.length ) {
		store.waitFor.forEach( function( dep ) {
			var depStore = lookup[ dep ];
			if ( depStore ) {
				_namespaces.push( store.namespace );
				var thisGen = calculateGen( depStore, lookup, gen + 1, actionType, _namespaces );
				if ( thisGen > calcdGen ) {
					calcdGen = thisGen;
				}
			} else {
				console.warn( `The "${actionType}" action in the "${store.namespace}" store waits for "${dep}" but a store with that namespace does not participate in this action.` );
			}
		} );
	}
	return calcdGen;
}

function buildGenerations( stores, actionType ) {
	var tree = [];
	var lookup = {};
	stores.forEach( ( store ) => lookup[ store.namespace ] = store );
	stores.forEach( ( store ) => store.gen = calculateGen( store, lookup, 0, actionType ) );
	for ( var [ key, item ] of entries( lookup ) ) {
		tree[ item.gen ] = tree[ item.gen ] || [];
		tree[ item.gen ].push( item );
	}
	return tree;
}

function processGeneration( generation, action ) {
	generation.map( ( store ) => {
		var data = Object.assign( {
			deps: _.pick( this.stores, store.waitFor )
		}, action );
		dispatcherChannel.publish(
			`${store.namespace}.handle.${action.actionType}`,
			data
		);
	} );
}

class Dispatcher extends machina.BehavioralFsm {
	constructor() {
		super( {
			initialState: "ready",
			actionMap: {},
			states: {
				ready: {
					_onEnter: function() {
						this.actionContext = undefined;
					},
					"action.dispatch": "dispatching"
				},
				dispatching: {
					_onEnter: function( luxAction ) {
						this.actionContext = luxAction;
						if ( luxAction.generations.length ) {
							for ( var generation of luxAction.generations ) {
								processGeneration.call( luxAction, generation, luxAction.action );
							}
							this.transition( luxAction, "notifying" );
						} else {
							this.transition( luxAction, "nothandled" );
						}
					},
					"action.handled": function( luxAction, data ) {
						if ( data.hasChanged ) {
							luxAction.updated.push( data.namespace );
						}
					},
					_onExit: function( luxAction ) {
						if ( luxAction.updated.length ) {
							dispatcherChannel.publish( "prenotify", { stores: luxAction.updated } );
						}
					}
				},
				notifying: {
					_onEnter: function( luxAction ) {
						dispatcherChannel.publish( "notify", {
							action: luxAction.action
						} );
					}
				},
				nothandled: {}
			},
			getStoresHandling( actionType ) {
				var stores = this.actionMap[ actionType ] || [];
				return {
					stores,
					generations: buildGenerations( stores, actionType )
				};
			}
		} );
		this.createSubscribers();
	}

	handleActionDispatch( data ) {
		var luxAction = Object.assign(
			{ action: data, generationIndex: 0, updated: [] },
			this.getStoresHandling( data.actionType )
		);
		this.handle( luxAction, "action.dispatch" );
	}

	registerStore( storeMeta ) {
		for ( var actionDef of storeMeta.actions ) {
			var action;
			var actionName = actionDef.actionType;
			var actionMeta = {
				namespace: storeMeta.namespace,
				waitFor: actionDef.waitFor
			};
			action = this.actionMap[ actionName ] = this.actionMap[ actionName ] || [];
			action.push( actionMeta );
		}
	}

	removeStore( namespace ) {
		var isThisNameSpace = function( meta ) {
			return meta.namespace === namespace;
		};
		for ( var [ k, v ] of entries( this.actionMap ) ) {
			var idx = v.findIndex( isThisNameSpace );
			if ( idx !== -1 ) {
				v.splice( idx, 1 );
			}
		}
	}

	createSubscribers() {
		if ( !this.__subscriptions || !this.__subscriptions.length ) {
			this.__subscriptions = [
				actionChannel.subscribe(
					"execute.*",
					( data, env ) => this.handleActionDispatch( data )
				),
				dispatcherChannel.subscribe(
					"*.handled.*",
					( data ) => this.handle( this.actionContext, "action.handled", data )
				).constraint( () => !!this.actionContext )
			];
		}
	}

	dispose() {
		if ( this.__subscriptions ) {
			this.__subscriptions.forEach( ( subscription ) => subscription.unsubscribe() );
			this.__subscriptions = null;
		}
	}
}

var dispatcher = new Dispatcher();

	

/* istanbul ignore next */
function getGroupsWithAction( actionName ) {
	var groups = [];
	for ( var [ group, list ] of entries( actionGroups ) ) {
		if ( list.indexOf( actionName ) >= 0 ) {
			groups.push( group );
		}
	}
	return groups;
}

// NOTE - these will eventually live in their own add-on lib or in a debug build of lux
/* istanbul ignore next */
var utils = {
	printActions() {
		var actionList = Object.keys( actions )
			.map( function( x ) {
				return {
					"action name": x,
					stores: dispatcher.getStoresHandling( x ).stores.map( function( x ) {
						return x.namespace;
					} ).join( "," ),
					groups: getGroupsWithAction( x ).join( "," )
				};
			} );
		if ( console && console.table ) {
			console.group( "Currently Recognized Actions" );
			console.table( actionList );
			console.groupEnd();
		} else if ( console && console.log ) {
			console.log( actionList );
		}
	},

	printStoreDepTree( actionType ) {
		var tree = [];
		actionType = typeof actionType === "string" ? [ actionType ] : actionType;
		if ( !actionType ) {
			actionType = Object.keys( actions );
		}
		actionType.forEach( function( at ) {
			dispatcher.getStoresHandling( at )
			    .generations.forEach( function( x ) {
				while ( x.length ) {
					var t = x.pop();
					tree.push( {
						"action type": at,
						"store namespace": t.namespace,
						"waits for": t.waitFor.join( "," ),
						generation: t.gen
					} );
				}
			    } );
			if ( console && console.table ) {
				console.group( `Store Dependency List for ${at}` );
				console.table( tree );
				console.groupEnd();
			} else if ( console && console.log ) {
				console.log( `Store Dependency List for ${at}:` );
				console.log( tree );
			}
			tree = [];
		} );
	}
};


	// jshint ignore: start
	return {
		actions,
		publishAction,
		addToActionGroup,
		component,
		controllerView,
		customActionCreator,
		dispatcher,
		getActionGroup,
		actionCreatorListener,
		actionCreator,
		actionListener,
		mixin: mixin,
		initReact( userReact ) {
			React = userReact;
			return this;
		},
		reactMixin,
		removeStore,
		Store,
		stores,
		utils
	};
	// jshint ignore: end
} ) );
