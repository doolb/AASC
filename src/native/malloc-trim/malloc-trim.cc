#include <node_api.h>
#include <malloc.h>

static napi_value MallocTrim(napi_env env, napi_callback_info info) {
    int result = malloc_trim(0);
    napi_value ret;
    napi_create_int32(env, result, &ret);
    return ret;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, NULL, NAPI_AUTO_LENGTH, MallocTrim, NULL, &fn);
    napi_set_named_property(env, exports, "trim", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
